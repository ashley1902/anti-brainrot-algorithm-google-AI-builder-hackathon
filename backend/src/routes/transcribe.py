"""
transcribe.py

FastAPI route: POST /api/transcribe

Downloads the audio from the given URL and returns a spoken transcript
using Faster-Whisper small (CPU, int8). Never exposes or logs the URL.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from ..schemas.transcribe import TranscribeRequest, TranscribeResponse
from ..services.transcribe_audio import transcribe_from_url

logger = logging.getLogger(__name__)
router = APIRouter()

MAX_BODY_BYTES = 4096  # URL + source — tiny payload


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe_audio(request: Request) -> JSONResponse:
    body_bytes = await request.body()
    if len(body_bytes) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Request body too large.")

    try:
        import json
        raw = json.loads(body_bytes)
        req = TranscribeRequest.model_validate(raw)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    print("\n" + "━" * 60)
    print("🎙️  TRANSCRIBE REQUEST:")
    print(f"   source={req.source}")
    # Do NOT log the audio URL — it may contain signed tokens / user identity
    print("━" * 60)

    transcript = await transcribe_from_url(req.audio_url)

    print(f"📝 TRANSCRIPT ({len(transcript)} chars): {transcript[:100]!r}")
    print("━" * 60 + "\n")

    return JSONResponse(content={"transcript": transcript})
