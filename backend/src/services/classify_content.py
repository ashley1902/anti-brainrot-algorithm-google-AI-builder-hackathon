"""
classify_content.py

Service layer: selects the appropriate AI provider and handles errors
from the provider layer, returning a stable error shape to the route.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

from ..providers.ai_provider import AIProvider, ProviderError, ProviderTimeoutError
from ..providers.deepseek_provider import DeepSeekProvider
from ..providers.mock_provider import MockProvider
from ..schemas.content_features import AnalyzeRequest, ContentFeatures

logger = logging.getLogger(__name__)

_provider: Optional[AIProvider] = None


def get_provider() -> AIProvider:
    """Return a singleton AI provider (lazy init)."""
    global _provider
    if _provider is None:
        api_key = os.environ.get("DEEPSEEK_API_KEY", "")
        if api_key.lower() == "mock" or not api_key:
            logger.warning(
                "[ABR] DEEPSEEK_API_KEY is 'mock' or unset — using MockProvider. "
                "Set a real key in backend/.env for live analysis."
            )
            _provider = MockProvider()
        else:
            _provider = DeepSeekProvider()
    return _provider


async def classify_content(request: AnalyzeRequest) -> ContentFeatures:
    """
    Classify content using the configured provider.
    Raises ProviderError / ProviderTimeoutError on failure.
    """
    provider = get_provider()
    try:
        return await provider.analyze(request)
    except ProviderTimeoutError:
        logger.warning("[ABR] Provider timed out.")
        raise
    except ProviderError as exc:
        # Log status code without logging raw error body / key material
        logger.warning("[ABR] Provider error (status=%s)", exc.status_code)
        raise
