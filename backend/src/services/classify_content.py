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
from ..providers.gemini_provider import GeminiProvider
from ..providers.mock_provider import MockProvider
from ..schemas.content_features import AnalyzeRequest, ContentFeatures

logger = logging.getLogger(__name__)

_provider: Optional[AIProvider] = None


def get_provider() -> AIProvider:
    """
    Return a singleton AI provider (lazy init).

    Priority:
      1. GEMINI_API_KEY  → GeminiProvider  (Google AI / Cloud Run deployment)
      2. DEEPSEEK_API_KEY → DeepSeekProvider (local dev fallback)
      3. neither / 'mock'  → MockProvider
    """
    global _provider
    if _provider is None:
        gemini_key  = os.environ.get("GEMINI_API_KEY", "")
        deepseek_key = os.environ.get("DEEPSEEK_API_KEY", "")

        if gemini_key and gemini_key.lower() != "mock":
            logger.info("[ABR] Using GeminiProvider (gemini-1.5-flash)")
            _provider = GeminiProvider()
        elif deepseek_key and deepseek_key.lower() != "mock":
            logger.info("[ABR] Using DeepSeekProvider")
            _provider = DeepSeekProvider()
        else:
            logger.warning(
                "[ABR] No API key set — using MockProvider. "
                "Set GEMINI_API_KEY or DEEPSEEK_API_KEY in backend/.env"
            )
            _provider = MockProvider()
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
