# Anti Brain Rot  Cloud Run Deployment

This branch (`deploy`) is the production-ready backend for Cloud Run.

## What's deployed where

| Component | Where it runs | How to share |
|---|---|---|
| FastAPI backend | **Google Cloud Run** | Public HTTPS URL |
| Chrome Extension | **Judge's browser** | Share `dist/` folder as ZIP  Load Unpacked |

---

## One-time GCP setup

```bash
# 1. Login & set project
gcloud auth login
gcloud projects create anti-brain-rot-demo
gcloud config set project anti-brain-rot-demo

# 2. Enable APIs
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

---

## Deploy the backend

```bash
cd backend

gcloud run deploy anti-brain-rot-backend \
  --source . \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "GEMINI_API_KEY=YOUR_KEY_HERE,GEMINI_MODEL=gemini-2.0-flash-lite" \
  --memory 512Mi \
  --cpu 1 \
  --timeout 30
```

> **API key is ONLY passed at deploy time via `--set-env-vars`.**
> It is never in the Dockerfile or committed to git.

After deploy you'll get a URL like:
```
https://anti-brain-rot-backend-xxxxxx-uc.a.run.app
```

Test it:
```bash
curl https://anti-brain-rot-backend-xxxxxx-uc.a.run.app/health
#  {"status":"ok"}
```

---

## Connect the extension

In the extension popup  Settings  set **Backend URL** to your Cloud Run URL.

Or run this once in the Service Worker console (chrome://extensions  SW  Inspect):
```js
chrome.storage.local.set({
  abr_settings: {
    enabled: true,
    backendUrl: 'https://anti-brain-rot-backend-xxxxxx-uc.a.run.app',
    dailyGoalMinutes: 60,
    interventionCooldownMinutes: 30
  }
})
```

---

## Share the extension with judges

```bash
# From the extension/ folder  build first
cd extension && npm run build

# Zip the dist/ folder
cd dist && zip -r ../anti-brain-rot-extension.zip .
```

Share `anti-brain-rot-extension.zip`. Judges:
1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**  select the unzipped `dist/` folder
4. Open Instagram Reels or YouTube Shorts and start scrolling

---

## Re-deploy after code changes

```bash
cd backend
gcloud run deploy anti-brain-rot-backend --source . --region us-central1
```

Cloud Run keeps the same URL  no extension update needed.
