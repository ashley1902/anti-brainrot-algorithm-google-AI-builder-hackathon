"""
ai_provider.py

Abstract base class for AI content classifiers.
Keeps provider-specific code behind an interface so DeepSeek can be
replaced by a local model or another provider later.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

from ..schemas.content_features import AnalyzeRequest, ContentFeatures


class AIProvider(ABC):
    """Interface for content classification providers."""

    @abstractmethod
    async def analyze(self, request: AnalyzeRequest) -> ContentFeatures:
        """
        Classify a piece of social-media content.

        Args:
            request: Validated input containing text and source.

        Returns:
            ContentFeatures: Validated, clamped feature scores.

        Raises:
            ProviderError: On non-retryable upstream failures.
            ProviderTimeoutError: When the upstream times out.
        """
        ...


class ProviderError(Exception):
    """Raised when the AI provider returns an error."""
    def __init__(self, message: str, status_code: Optional[int] = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class ProviderTimeoutError(ProviderError):
    """Raised when the AI provider request times out."""
