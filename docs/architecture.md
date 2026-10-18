# Architecture  Anti Brain Rot V0.1

## Overview

```
Browser (YouTube Shorts tab)

 Content Script (content/content.ts)
    YouTube Shorts adapter  extracts title + description
    MutationObserver + URL change detection
    Debounce (800ms) + deduplication (fingerprint hash)
    Intervention overlay (intervention-ui.ts)

 Service Worker (background/service-worker.ts)
    Message router
    Session engine (SessionManager)
    Intervention policy evaluator
    Calls localhost backend

 Popup (popup/popup.ts + popup.html)
    Session snapshot display
    Pause / Resume / Clear controls
    Sensitivity setting

 chrome.storage.local  Settings only (no raw content)

Localhost Backend (Python FastAPI, port 8787)

 POST /api/analyze
    Pydantic validation + body-size limit
    DeepSeekProvider (or MockProvider)
    Returns ContentFeatures (numbers + tags only)

 GET /health  { status: "ok" }

DeepSeek API (cloud)
 chat/completions  structured JSON classification
```

## Key design decisions

### Session state location
Session state lives in the **service worker** for V0.1. This is simple but means state is reset if the service worker is suspended. A future version can persist state to `chrome.storage.session`.

### No raw text persistence
Extracted text is used only as the body of an outgoing HTTP request. It is never written to `chrome.storage`, application logs, or any persistent medium.

### API key security
The DeepSeek API key is held **only** in the localhost backend's `.env` file. It is never included in the extension source code, `manifest.json`, or any committed file.

### Scoring
Content impact is a deterministic weighted formula (see `scoring.ts`). It is an experimental heuristic, not a validated clinical metric. Weights are documented and configurable.

### Intervention policy
A pure function with explicit gates (minimum items, minimum duration, impact threshold, trajectory/exposure condition, prompt budget, cooldown). All thresholds are configurable via settings.

## Component boundaries

| Component | Can read | Cannot read |
|---|---|---|
| Content script | Visible DOM text | chrome.storage (except via message) |
| Service worker | chrome.storage, messages | Page DOM |
| Popup | chrome.storage, messages | Page DOM |
| Backend | Request body | Extension storage, page DOM, browser state |
| DeepSeek API | Text sent by backend | Everything else |
