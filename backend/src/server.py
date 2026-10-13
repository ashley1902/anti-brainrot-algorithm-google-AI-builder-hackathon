"""
server.py

Anti Brain Rot — local development backend.

⚠️  SECURITY NOTICE ⚠️
This server is for LOCAL DEVELOPMENT ONLY.
- No authentication
- No rate limiting
- No abuse protection
- No HTTPS
- Binds to localhost only

Do NOT expose this on a public network.
For production: add auth, rate limits, HTTPS, secret management,
and a proper deployment pipeline.
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
    title="Anti Brain Rot — Dev Backend",
    description=(
        "Local development proxy. Keeps the DeepSeek API key out of the "
        "Chrome extension. NOT suitable for public deployment."
    ),
    version="0.1.0",
    docs_url="/docs",
    redoc_url=None,
)

# ─── CORS ──────────────────────────────────────────────────────────────────────
# Allow only the Chrome extension origin for the analyze endpoint.
# chrome-extension:// origins are allowed so the extension's service worker
# can call the backend directly.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost",
        "http://127.0.0.1",
        # Chrome extensions have their own origin scheme; browsers handle this
        # but listing it explicitly signals intent.
        "chrome-extension://",
    ],
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
    logger.info("Starting Anti Brain Rot dev backend on http://127.0.0.1:%d", port)
    logger.warning(
        "⚠️  This is a LOCAL DEV server with NO auth/rate-limiting. "
        "Do not expose on a public network."
    )
    uvicorn.run(
        "src.server:app",
        host="127.0.0.1",
        port=port,
        reload=True,
        log_level="info",
    )
