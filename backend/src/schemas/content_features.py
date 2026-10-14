"""
content_features.py

Pydantic schema for the AI provider output.

All numeric scores are ESTIMATES of content characteristics.
They are NOT clinical measurements, mood assessments, or diagnoses.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field, field_validator


class ContentFeatures(BaseModel):
    """
    Validated output from the AI classifier.

    Numeric ranges:
      sentiment:         -1.0 to +1.0
      all other scores:   0.0 to  1.0
    """

    topicTags: list[str] = Field(default_factory=list)
    sentiment: float = Field(0.0, ge=-1.0, le=1.0)
    emotionalIntensity: float = Field(0.0, ge=0.0, le=1.0)
    anxietyRelated: float = Field(0.0, ge=0.0, le=1.0)
    sadness: float = Field(0.0, ge=0.0, le=1.0)
    anger: float = Field(0.0, ge=0.0, le=1.0)
    fear: float = Field(0.0, ge=0.0, le=1.0)
    socialComparison: float = Field(0.0, ge=0.0, le=1.0)
    relationshipDistress: float = Field(0.0, ge=0.0, le=1.0)
    careerAnxiety: float = Field(0.0, ge=0.0, le=1.0)
    financialAnxiety: float = Field(0.0, ge=0.0, le=1.0)
    bodyImagePressure: float = Field(0.0, ge=0.0, le=1.0)
    fomo: float = Field(0.0, ge=0.0, le=1.0)
    rageBait: float = Field(0.0, ge=0.0, le=1.0)
    toxicity: float = Field(0.0, ge=0.0, le=1.0)
    humor: float = Field(0.0, ge=0.0, le=1.0)
    educational: float = Field(0.0, ge=0.0, le=1.0)
    inspirational: float = Field(0.0, ge=0.0, le=1.0)
    envy: float = Field(0.0, ge=0.0, le=1.0)
    doom: float = Field(0.0, ge=0.0, le=1.0)
    fearMongering: float = Field(0.0, ge=0.0, le=1.0)
    dramaGossip: float = Field(0.0, ge=0.0, le=1.0)
    clickbait: float = Field(0.0, ge=0.0, le=1.0)
    cliffhanger: float = Field(0.0, ge=0.0, le=1.0)
    validationSeeking: float = Field(0.0, ge=0.0, le=1.0)
    nourishing: float = Field(0.0, ge=0.0, le=1.0)
    confidence: float = Field(1.0, ge=0.0, le=1.0)
    insufficientContext: bool = False

    @field_validator(
        "emotionalIntensity", "anxietyRelated", "sadness", "anger", "fear",
        "socialComparison", "relationshipDistress", "careerAnxiety",
        "financialAnxiety", "bodyImagePressure", "fomo", "rageBait",
        "toxicity", "humor", "educational", "inspirational",
        "envy", "doom", "fearMongering", "dramaGossip",
        "clickbait", "cliffhanger", "validationSeeking", "nourishing",
        "confidence",
        mode="before",
    )
    @classmethod
    def clamp_01(cls, v: object) -> float:
        """Clamp 0–1 fields and coerce non-numbers to 0."""
        try:
            return max(0.0, min(1.0, float(v)))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return 0.0

    @field_validator("sentiment", mode="before")
    @classmethod
    def clamp_sentiment(cls, v: object) -> float:
        """Clamp sentiment to [-1, 1]."""
        try:
            return max(-1.0, min(1.0, float(v)))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return 0.0


class AnalyzeRequest(BaseModel):
    """Request body for POST /api/analyze."""

    # Increased from 800 to 2000 to accommodate caption + audio track + top comments
    text: str = Field(..., min_length=1, max_length=2000)
    source: str = Field(..., pattern=r"^(youtube_shorts|instagram_reels)$")
    language: Optional[str] = None
