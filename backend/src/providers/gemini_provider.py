"""
gemini_provider.py

Google Gemini (via Google AI Studio API) provider for content classification.

Uses gemini-1.5-flash — fast, cheap, excellent at structured JSON output.
Set GEMINI_API_KEY in .env (get one free at https://aistudio.google.com/apikey).

Same system prompt and output schema as DeepSeekProvider — fully interchangeable.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Optional

import google.generativeai as genai

from ..schemas.content_features import AnalyzeRequest, ContentFeatures
from .ai_provider import AIProvider, ProviderError, ProviderTimeoutError
from .deepseek_provider import SYSTEM_PROMPT  # reuse identical prompt

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT_S = 15.0
MAX_TEXT_CHARS = 2000


class GeminiProvider(AIProvider):
    """
    Calls the Google Gemini API (gemini-1.5-flash) to classify content features.
    Structurally identical to DeepSeekProvider — same prompt, same output schema.
    """

    def __init__(self) -> None:
        api_key = os.environ.get("GEMINI_API_KEY", "")
        if not api_key:
            raise RuntimeError(
                "GEMINI_API_KEY environment variable is not set. "
                "Get a free key at https://aistudio.google.com/apikey and add it to backend/.env"
            )
        genai.configure(api_key=api_key)
        self._model = genai.GenerativeModel(
            model_name=os.environ.get("GEMINI_MODEL", "gemini-2.0-flash-lite"),
            system_instruction=SYSTEM_PROMPT,
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json",
                temperature=0.1,
                max_output_tokens=600,
            ),
        )

    async def analyze(self, request: AnalyzeRequest) -> ContentFeatures:
        text = request.text[:MAX_TEXT_CHARS]

        source_label = {
            "youtube_shorts": "YouTube Shorts title/description",
            "instagram_reels": "Instagram Reels caption",
        }.get(request.source, "short-form video content")

        user_message = f"{source_label} to classify:\n\n{text}"

        # ── Dev logging ───────────────────────────────────────────────────────
        print("\n" + "━" * 60)
        print("📤 CONTENT SENT TO GEMINI:")
        print(f"   {text!r}")
        print("━" * 60)

        raw = await self._call_api(user_message)

        print("📥 GEMINI RAW RESPONSE:")
        print(f"   {raw}")
        print("━" * 60 + "\n")

        features: Optional[ContentFeatures] = self._parse_response(raw)

        if features is None:
            # Gemini with response_mime_type="application/json" rarely fails,
            # but attempt a simple repair by stripping markdown fences.
            cleaned = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            features = self._parse_response(cleaned)

        if features is None:
            raise ProviderError("Gemini returned malformed JSON after cleanup attempt.")

        print("✅ PARSED FEATURES (Gemini):")
        print(f"   sentiment={features.sentiment:.2f}  emotionalIntensity={features.emotionalIntensity:.2f}  rageBait={features.rageBait:.2f}")
        print(f"   topics={features.topicTags}  insufficientContext={features.insufficientContext}")
        print("━" * 60 + "\n")

        return features

    async def _call_api(self, user_message: str) -> str:
        """Send a message to Gemini and return the raw text response."""
        import asyncio

        try:
            # google-generativeai's async method
            response = await asyncio.wait_for(
                self._model.generate_content_async(user_message),
                timeout=REQUEST_TIMEOUT_S,
            )
            return response.text
        except asyncio.TimeoutError:
            raise ProviderTimeoutError("Gemini request timed out.")
        except Exception as exc:
            # Catch broad google-generativeai exceptions
            msg = str(exc)
            if "429" in msg or "quota" in msg.lower():
                raise ProviderError("Gemini rate limit / quota exceeded.", status_code=429)
            raise ProviderError(f"Gemini API error: {type(exc).__name__}: {msg}")

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
