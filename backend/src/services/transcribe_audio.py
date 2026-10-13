"""
transcribe_audio.py

Downloads an audio/video file from a URL and transcribes it using
faster-whisper (small model, CPU, int8 quantisation).

The model is loaded once on first call and reused across requests.
Raw audio is processed locally — it is never sent to any cloud service.
"""

from __future__ import annotations

import logging
import os
import tempfile
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# ─── Lazy model singleton ─────────────────────────────────────────────────────
# Loaded on the first transcription request so server startup stays fast.
_whisper_model = None

def _get_model():
    global _whisper_model
    if _whisper_model is None:
        try:
            from faster_whisper import WhisperModel  # type: ignore
            logger.info("[Whisper] Loading small model (CPU, int8) — first request only…")
            _whisper_model = WhisperModel(
                "small",
                device="cpu",
                compute_type="int8",
            )
            logger.info("[Whisper] Model ready.")
        except ImportError:
            raise RuntimeError(
                "faster-whisper is not installed. "
                "Run: pip install faster-whisper"
            )
    return _whisper_model


# ─── Download ─────────────────────────────────────────────────────────────────
MAX_AUDIO_BYTES = 30 * 1024 * 1024   # 30 MB guard — a 60-second reel is ~3–8 MB
DOWNLOAD_TIMEOUT_S = 30.0


async def _download_audio(url: str) -> str:
    """
    Download the audio/video from *url* to a temp file.
    Returns the temp file path. Caller must delete it.
    Raises httpx.HTTPError or ValueError on failure.
    """
    suffix = ".mp4" if "mp4" in url.lower() else ".m4a"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp_path = tmp.name
    tmp.close()

    try:
        async with httpx.AsyncClient(
            timeout=DOWNLOAD_TIMEOUT_S,
            follow_redirects=True,
            headers={
                # Mimic a browser so CDNs don't reject the request
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/126.0.0.0 Safari/537.36"
                ),
            },
        ) as client:
            async with client.stream("GET", url) as resp:
                resp.raise_for_status()
                total = 0
                with open(tmp_path, "wb") as f:
                    async for chunk in resp.aiter_bytes(chunk_size=65536):
                        total += len(chunk)
                        if total > MAX_AUDIO_BYTES:
                            raise ValueError(
                                f"Audio file exceeds {MAX_AUDIO_BYTES // (1024*1024)} MB limit"
                            )
                        f.write(chunk)
        logger.info("[Whisper] Downloaded %.1f KB to %s", total / 1024, tmp_path)
        return tmp_path
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


# ─── Transcribe ───────────────────────────────────────────────────────────────
MAX_TRANSCRIPT_CHARS = 600
NO_SPEECH_THRESHOLD  = 0.6
AVG_LOGPROB_THRESHOLD = -1.0


async def transcribe_from_url(audio_url: str) -> str:
    """
    Download *audio_url* and return a spoken transcript (≤ 600 chars).
    Returns "" on any failure — never raises so the analysis pipeline
    can continue without a transcript.
    """
    tmp_path: Optional[str] = None
    try:
        tmp_path = await _download_audio(audio_url)
        model = _get_model()

        segments, info = model.transcribe(
            tmp_path,
            language=None,           # auto-detect
            condition_on_previous_text=False,
            vad_filter=False,        # we don't pre-filter silence
            beam_size=5,
        )

        logger.info(
            "[Whisper] Detected language: %s (prob=%.2f)",
            info.language,
            info.language_probability,
        )

        parts: list[str] = []
        for seg in segments:
            if seg.no_speech_prob >= NO_SPEECH_THRESHOLD:
                continue
            if seg.avg_logprob < AVG_LOGPROB_THRESHOLD:
                continue
            parts.append(seg.text.strip())

        transcript = " ".join(parts).strip()
        transcript = transcript[:MAX_TRANSCRIPT_CHARS]

        logger.info("[Whisper] Transcript (%d chars): %r", len(transcript), transcript[:80])
        return transcript

    except Exception as exc:
        logger.warning("[Whisper] Transcription failed: %s", exc)
        return ""
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
