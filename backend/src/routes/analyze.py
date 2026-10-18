"""
analyze.py

FastAPI route: POST /api/analyze

Enforces body-size limits, validates source type, calls the classification
service, and returns only ContentFeatures. Request bodies and model
responses are NOT logged.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from ..providers.ai_provider import ProviderError, ProviderTimeoutError
from ..schemas.content_features import AnalyzeRequest, ContentFeatures
from ..services.classify_content import classify_content

logger = logging.getLogger(__name__)
router = APIRouter()

# Max body size enforced at the route level (bytes)  schema also enforces text length
# Increased to accommodate caption + audio track + top 5 comments
MAX_BODY_BYTES = 8192


@router.post("/analyze", response_model=ContentFeatures)
async def analyze_content(request: Request) -> JSONResponse:
    # Enforce raw body size limit before Pydantic parsing
    body_bytes = await request.body()
    if len(body_bytes) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Request body too large.")

    # Parse and validate with Pydantic
    try:
        import json
        raw = json.loads(body_bytes)
        analyze_request = AnalyzeRequest.model_validate(raw)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Classify
    try:
        features = await classify_content(analyze_request)
    except ProviderTimeoutError:
        raise HTTPException(status_code=504, detail="AI provider timed out. Try again shortly.")
    except ProviderError as exc:
        status = exc.status_code or 502
        if status == 429:
            raise HTTPException(status_code=429, detail="AI provider rate limit reached.")
        raise HTTPException(status_code=502, detail="AI provider error. Check backend logs.")

    # Return only the feature object  never echo back the input text
    return JSONResponse(content=features.model_dump())
