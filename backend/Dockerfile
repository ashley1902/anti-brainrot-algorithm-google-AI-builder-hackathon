# ─── Anti Brain Rot — Cloud Run Backend ──────────────────────────────────────
# Uses requirements-cloud.txt (no faster-whisper) for a lean ~250 MB image.
# Cloud Run sets PORT automatically; uvicorn binds 0.0.0.0:$PORT.

FROM python:3.11-slim

# System deps (httpx needs ca-certs; uvicorn[standard] needs uvloop build tools)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    build-essential \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (cached layer unless requirements change)
COPY requirements-cloud.txt .
RUN pip install --no-cache-dir -r requirements-cloud.txt

# Copy source
COPY src/ ./src/
# NOTE: .env is intentionally NOT copied — secrets are injected at deploy time
# via Cloud Run --set-env-vars or Secret Manager.

# Cloud Run provides PORT; default to 8080 for local docker run
ENV PORT=8080
ENV GEMINI_MODEL=gemini-2.0-flash-lite

# Tell Python not to buffer stdout so Cloud Run sees logs immediately
ENV PYTHONUNBUFFERED=1

EXPOSE 8080

CMD ["sh", "-c", "python -m uvicorn src.server:app --host 0.0.0.0 --port $PORT --log-level info"]
