"""
transcribe.py

Pydantic schemas for the /api/transcribe endpoint.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class TranscribeRequest(BaseModel):
    """Request body: a publicly-accessible audio/video URL to transcribe."""
    audio_url: str = Field(..., min_length=10)
    source: str = Field(..., pattern=r"^(youtube_shorts|instagram_reels)$")


class TranscribeResponse(BaseModel):
    """Response: the spoken transcript, or empty string if nothing was detected."""
    transcript: str
