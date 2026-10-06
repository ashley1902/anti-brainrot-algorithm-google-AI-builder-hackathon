"""
mock_provider.py

Mock AI provider for tests and local development without a DeepSeek API key.
Returns deterministic, configurable ContentFeatures without any network calls.

Enable by setting DEEPSEEK_API_KEY=mock in .env.
"""

from __future__ import annotations

from ..schemas.content_features import AnalyzeRequest, ContentFeatures
from .ai_provider import AIProvider


class MockProvider(AIProvider):
    """Returns neutral features. Override `_features` in tests as needed."""

    def __init__(self, features: ContentFeatures | None = None) -> None:
        self._features = features or ContentFeatures(
            topicTags=["mock", "test"],
            sentiment=0.1,
            emotionalIntensity=0.2,
            anxietyRelated=0.1,
            humor=0.5,
            educational=0.4,
            confidence=0.9,
            insufficientContext=False,
        )

    async def analyze(self, request: AnalyzeRequest) -> ContentFeatures:
        return self._features
