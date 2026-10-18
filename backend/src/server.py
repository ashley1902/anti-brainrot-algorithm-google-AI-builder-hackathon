"""
server.py

Anti Brain Rot — FastAPI backend.

Supports two deployment modes:
  - Local dev:   python -m src.server  (binds 127.0.0.1:8787)
  - Cloud Run:   PORT env var set by GCP, binds 0.0.0.0:$PORT

AI Provider selection (set in .env or Cloud Run env vars):
  GEMINI_API_KEY   → GeminiProvider  (recommended for GCP deployment)
  DEEPSEEK_API_KEY → DeepSeekProvider (local dev alternative)
"""

from __future__ import annotations

import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load .env before any provider imports read env vars
load_dotenv()

from .routes.analyze import router as analyze_router      # noqa: E402
from .routes.transcribe import router as transcribe_router  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Anti Brain Rot — Backend",
    description=(
        "Content analysis backend. Powered by Google Gemini (gemini-1.5-flash) "
        "via Vertex AI / Google AI Studio. Deployed on Cloud Run."
    ),
    version="0.2.0",
    docs_url="/docs",
    redoc_url=None,
)

# ─── CORS ──────────────────────────────────────────────────────────────────────
# Allow Chrome extension origins (chrome-extension://*) and localhost for dev.
# Cloud Run serves HTTPS so the extension service worker can call it directly.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_origin_regex=r"chrome-extension://.*",
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

# ─── Routes ───────────────────────────────────────────────────────────────────
app.include_router(analyze_router, prefix="/api")
app.include_router(transcribe_router, prefix="/api")


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    """Health check. Does NOT expose environment variables or secrets."""
    return {"status": "ok"}


# ─── Dev entrypoint ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8787"))
    # Cloud Run sets PORT and expects 0.0.0.0; local dev defaults to 127.0.0.1
    host = "0.0.0.0" if os.environ.get("K_SERVICE") else "127.0.0.1"
    reload = not bool(os.environ.get("K_SERVICE"))  # no hot-reload on Cloud Run

    logger.info("Starting Anti Brain Rot backend on %s:%d (Cloud Run: %s)", host, port, bool(os.environ.get("K_SERVICE")))
    uvicorn.run(
        "src.server:app",
        host=host,
        port=port,
        reload=reload,
        log_level="info",
    )
