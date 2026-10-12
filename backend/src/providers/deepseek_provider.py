"""
deepseek_provider.py

DeepSeek API provider implementation.

Security: The API key is read from the environment variable DEEPSEEK_API_KEY.
It is NEVER logged, returned in responses, or embedded in source code.

Privacy: The text submitted for analysis is sent to DeepSeek's API (a cloud
service). Users should review DeepSeek's current data-handling terms before
real-world use. Raw prompts and responses are NOT logged by this backend.

Rate limiting / retries: A single retry with a strict-format repair prompt
is attempted on malformed JSON. No indefinite retries.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Optional

import httpx

from ..schemas.content_features import AnalyzeRequest, ContentFeatures
from .ai_provider import AIProvider, ProviderError, ProviderTimeoutError

logger = logging.getLogger(__name__)

# ─── System prompt ────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """\
You classify characteristics of short-form social media content (YouTube Shorts
or Instagram Reels captions/titles) for a digital-wellbeing prototype. The
input is typically a short title or caption — this is expected and normal.
A short caption alone IS sufficient context; do not set insufficientContext=true
just because the text is brief.

The input may optionally include one or both of:
  - "Audio track: ..." — the song/music being used in the reel or short.
    Use this to inform emotional tone (e.g. a sad song raises sadness score).
  - "Top comments: ..." — a numbered list of viewer comments.
    Use these to understand audience reaction (e.g. grief comments raise sadness).

Only set insufficientContext=true if the text is completely meaningless (e.g.
random characters, a single emoji with no context, or clearly corrupted text).

Analyze only the supplied text. Do not infer the viewer's mood, mental health,
diagnosis, intent, or biological state. Return ONLY a valid JSON object
matching the schema below — no markdown, no explanation, no extra keys.

Score based on what the title/description (and any audio/comment context) signals
about the content's emotional character. Be appropriately specific — do not
default everything to 0.0.

Do not reproduce the supplied content in your response.

Schema (all numbers must be within the stated range):
{
  "topicTags": [string, ...],      // 0–5 short topic labels
  "sentiment": float,              // -1.0 (very negative) to +1.0 (very positive)
  "emotionalIntensity": float,     // 0.0 to 1.0
  "anxietyRelated": float,         // 0.0 to 1.0
  "sadness": float,                // 0.0 to 1.0
  "anger": float,                  // 0.0 to 1.0
  "fear": float,                   // 0.0 to 1.0
  "socialComparison": float,       // 0.0 to 1.0
  "relationshipDistress": float,   // 0.0 to 1.0
  "careerAnxiety": float,          // 0.0 to 1.0
  "financialAnxiety": float,       // 0.0 to 1.0
  "bodyImagePressure": float,      // 0.0 to 1.0
  "fomo": float,                   // 0.0 to 1.0
  "rageBait": float,               // 0.0 to 1.0 (uncertain; do not overuse)
  "toxicity": float,               // 0.0 to 1.0
  "humor": float,                  // 0.0 to 1.0
  "educational": float,            // 0.0 to 1.0
  "inspirational": float,          // 0.0 to 1.0
  "confidence": float,             // 0.0 to 1.0 (your confidence in this classification)
  "insufficientContext": bool
}
"""

REPAIR_PROMPT = """\
Your previous response was not valid JSON. Return ONLY the JSON object, with no
markdown fences, no text before or after, and no comments. Follow the exact
schema from the system instruction.
"""

REQUEST_TIMEOUT_S = 12.0
MAX_TEXT_CHARS = 2000  # enforced by request schema; mirrored here as a guard


class DeepSeekProvider(AIProvider):
    """
    Calls the DeepSeek chat/completions API to classify content features.
    """

    def __init__(self) -> None:
        api_key = os.environ.get("DEEPSEEK_API_KEY", "")
        if not api_key:
            raise RuntimeError(
                "DEEPSEEK_API_KEY environment variable is not set. "
                "Copy backend/.env.example to backend/.env and add your key."
            )
        self._api_key = api_key
        self._base_url = os.environ.get(
            "DEEPSEEK_BASE_URL", "https://api.deepseek.com"
        ).rstrip("/")
        self._model = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")

    async def analyze(self, request: AnalyzeRequest) -> ContentFeatures:
        text = request.text[:MAX_TEXT_CHARS]

        source_label = {
            "youtube_shorts": "YouTube Shorts title/description",
            "instagram_reels": "Instagram Reels caption",
        }.get(request.source, "short-form video content")

        messages: list[dict[str, str]] = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"{source_label} to classify:\n\n{text}"},
        ]

        # ── Dev logging ───────────────────────────────────────────────────────
        print("\n" + "━" * 60)
        print("📤 CONTENT SENT TO DEEPSEEK:")
        print(f"   {text!r}")
        print("━" * 60)

        raw = await self._call_api(messages)

        print("📥 DEEPSEEK RAW RESPONSE:")
        print(f"   {raw}")
        print("━" * 60 + "\n")
        # ─────────────────────────────────────────────────────────────────────

        # Parse JSON; retry once with repair prompt on failure
        features: Optional[ContentFeatures] = self._parse_response(raw)
        if features is None:
            logger.warning("[ABR] Malformed JSON on first attempt — retrying with repair prompt")
            messages.append({"role": "assistant", "content": raw})
            messages.append({"role": "user", "content": REPAIR_PROMPT})
            raw2 = await self._call_api(messages)

            print("📥 DEEPSEEK RETRY RESPONSE:")
            print(f"   {raw2}")
            print("━" * 60 + "\n")

            features = self._parse_response(raw2)

        if features is None:
            raise ProviderError("Model returned malformed JSON after retry.")

        print("✅ PARSED FEATURES:")
        print(f"   sentiment={features.sentiment:.2f}  emotionalIntensity={features.emotionalIntensity:.2f}  rageBait={features.rageBait:.2f}")
        print(f"   topics={features.topicTags}  insufficientContext={features.insufficientContext}")
        print("━" * 60 + "\n")

        return features

    async def _call_api(self, messages: list[dict[str, str]]) -> str:
        """
        POST to DeepSeek chat/completions. Returns the raw assistant message text.
        Raises ProviderError or ProviderTimeoutError on failure.
        Does NOT log request bodies or response content.
        """
        url = f"{self._base_url}/chat/completions"
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": messages,
            "temperature": 0.1,
            "max_tokens": 512,
            "response_format": {"type": "json_object"},
        }
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_S) as client:
                resp = await client.post(url, json=payload, headers=headers)
        except httpx.TimeoutException:
            raise ProviderTimeoutError("DeepSeek request timed out.")
        except httpx.RequestError as exc:
            raise ProviderError(f"Network error contacting DeepSeek: {type(exc).__name__}")

        if resp.status_code == 429:
            raise ProviderError("DeepSeek rate limit exceeded (429).", status_code=429)
        if resp.status_code >= 400:
            # Do NOT include response body in the error — it may contain key info
            raise ProviderError(
                f"DeepSeek returned HTTP {resp.status_code}.",
                status_code=resp.status_code,
            )

        data = resp.json()
        try:
            content: str = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            raise ProviderError("Unexpected response shape from DeepSeek.")

        return content

    @staticmethod
    def _parse_response(raw: str) -> Optional[ContentFeatures]:
        """Parse and validate the model output. Returns None on failure."""
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError:
            return None
        try:
            return ContentFeatures.model_validate(obj)
        except Exception:
            return None
