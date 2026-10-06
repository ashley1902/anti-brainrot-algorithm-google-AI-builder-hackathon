"""
test_analyze.py

Tests for the /api/analyze route and classification pipeline.
Uses MockProvider — no network calls, no API key required.
"""

from __future__ import annotations

import json
import os

import pytest
from fastapi.testclient import TestClient

# Force mock provider before any module imports the real one
os.environ["DEEPSEEK_API_KEY"] = "mock"

from src.server import app  # noqa: E402 — must be after env var set
from src.services import classify_content as classify_module  # noqa: E402

client = TestClient(app)


# ─── Reset provider singleton between tests ───────────────────────────────────
@pytest.fixture(autouse=True)
def reset_provider():
    classify_module._provider = None
    yield
    classify_module._provider = None


# ─── /health ─────────────────────────────────────────────────────────────────
def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_health_does_not_expose_env():
    resp = client.get("/health")
    body = resp.text
    assert "DEEPSEEK" not in body
    assert "mock" not in body


# ─── /api/analyze — validation ────────────────────────────────────────────────
def test_analyze_valid_request():
    resp = client.post(
        "/api/analyze",
        content=json.dumps({"text": "This is a fun cat video!", "source": "youtube_shorts"}),
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 200
    data = resp.json()
    # Check required fields are present and within range
    assert "sentiment" in data
    assert -1.0 <= data["sentiment"] <= 1.0
    assert "emotionalIntensity" in data
    assert 0.0 <= data["emotionalIntensity"] <= 1.0
    assert "topicTags" in data
    assert isinstance(data["topicTags"], list)
    assert "insufficientContext" in data


def test_analyze_rejects_empty_text():
    resp = client.post(
        "/api/analyze",
        content=json.dumps({"text": "", "source": "youtube_shorts"}),
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 422


def test_analyze_rejects_missing_source():
    resp = client.post(
        "/api/analyze",
        content=json.dumps({"text": "some text"}),
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 422


def test_analyze_rejects_unsupported_source():
    resp = client.post(
        "/api/analyze",
        content=json.dumps({"text": "some text", "source": "tiktok"}),
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 422


def test_analyze_rejects_oversized_body():
    huge = "x" * 5000
    resp = client.post(
        "/api/analyze",
        content=json.dumps({"text": huge, "source": "youtube_shorts"}),
        headers={"Content-Type": "application/json"},
    )
    # Either 413 (too large body) or 422 (text too long via schema)
    assert resp.status_code in (413, 422)


def test_analyze_does_not_echo_input_text():
    """Ensure the response never contains the raw submitted text."""
    resp = client.post(
        "/api/analyze",
        content=json.dumps({"text": "SECRET_CANARY_12345", "source": "youtube_shorts"}),
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 200
    assert "SECRET_CANARY_12345" not in resp.text


# ─── Schema validation ────────────────────────────────────────────────────────
def test_content_features_clamping():
    from src.schemas.content_features import ContentFeatures

    # Out-of-range values should be clamped, not raise
    features = ContentFeatures.model_validate({
        "sentiment": 5.0,         # should clamp to 1.0
        "emotionalIntensity": -2, # should clamp to 0.0
        "rageBait": "bad",        # non-number → 0.0
        "topicTags": [],
    })
    assert features.sentiment == 1.0
    assert features.emotionalIntensity == 0.0
    assert features.rageBait == 0.0


def test_content_features_defaults():
    from src.schemas.content_features import ContentFeatures

    features = ContentFeatures()
    assert features.insufficientContext is False
    assert features.confidence == 1.0
    assert features.topicTags == []


# ─── Mock provider ────────────────────────────────────────────────────────────
def test_mock_provider_returns_valid_features():
    from src.providers.mock_provider import MockProvider
    from src.schemas.content_features import AnalyzeRequest
    import asyncio

    provider = MockProvider()
    request = AnalyzeRequest(text="hello", source="youtube_shorts")
    features = asyncio.get_event_loop().run_until_complete(provider.analyze(request))
    assert -1.0 <= features.sentiment <= 1.0
    assert 0.0 <= features.emotionalIntensity <= 1.0
