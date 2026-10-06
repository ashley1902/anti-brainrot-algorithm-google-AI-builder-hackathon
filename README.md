# 🧠 Anti Brain Rot — Chrome Extension

A privacy-conscious digital-wellbeing browser extension that analyzes limited social-media content, identifies potentially unhelpful scrolling patterns, and offers gentle, user-controlled break prompts.

> **V0.1 — text-first prototype.** Supports YouTube Shorts. Uses a local backend proxy to call DeepSeek for content classification.

---

## ⚠️ Important caveats

- **Not fully on-device in V0.1.** Content text is sent to a localhost backend which calls the DeepSeek API (a cloud service). Text leaves your device.
- **Not a medical tool.** Scores are content-characteristic estimates, not assessments of your mood, mental health, or wellbeing.
- **The localhost backend has no authentication or rate limiting.** It is for local development only. Do not expose it on a public network.

---

## Project structure

```
anti-brain-rot/
├── extension/          Chrome Extension (TypeScript + Webpack)
│   ├── manifest.json
│   ├── src/
│   │   ├── background/ Service worker
│   │   ├── content/    Content script + site adapters + intervention UI
│   │   ├── session/    Scoring, trajectory, intervention policy
│   │   ├── storage/    Settings (chrome.storage.local)
│   │   └── popup/      Popup UI
│   └── tests/          Unit tests (Vitest)
├── backend/            Local dev proxy (Python FastAPI)
│   ├── src/
│   │   ├── providers/  AIProvider interface + DeepSeek + Mock
│   │   ├── schemas/    Pydantic models
│   │   ├── routes/     FastAPI routes
│   │   └── services/   Classification service
│   └── tests/          pytest tests
└── docs/               Architecture + privacy docs
```

---

## Prerequisites

- **Node.js** ≥ 18 and **npm** ≥ 9
- **Python** ≥ 3.11 and **pip**
- **Chrome** (or Chromium)
- A **DeepSeek API key** from [platform.deepseek.com](https://platform.deepseek.com/)

---

## Setup

### 1. Clone and install extension dependencies

```bash
cd extension
npm install
```

### 2. Build the extension

```bash
# Development build (with source maps, watch mode)
npm run dev

# Production build
npm run build
```

The built extension is output to `extension/dist/`.

### 3. Load the extension in Chrome

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `extension/dist/` folder

### 4. Set up the Python backend

```bash
cd backend

# Create a virtual environment (recommended)
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Copy the example env file and add your DeepSeek API key
cp .env.example .env
# Edit .env and set DEEPSEEK_API_KEY=your_key_here
```

### 5. Start the backend

```bash
cd backend
python -m src.server
```

The backend starts at **http://127.0.0.1:8787**.

Verify it's running:
```bash
curl http://127.0.0.1:8787/health
# → {"status":"ok"}
```

### 6. Use the extension

1. Navigate to `youtube.com/shorts/` in Chrome
2. Click the Anti Brain Rot icon in the toolbar
3. Verify monitoring is **Active**
4. Browse through a few Shorts — the popup will update with content impact estimates

---

## Running without a DeepSeek API key (mock mode)

Set `DEEPSEEK_API_KEY=mock` in `backend/.env`. The backend will use a mock provider that returns neutral, fixed features. Session tracking and the intervention UI still work fully.

---

## Running tests

### Extension tests (Vitest — pure logic, no API calls)

```bash
cd extension
npm test
```

Tests cover: scoring formula, trajectory classification, intervention policy state machine.

### Backend tests (pytest — mock provider, no API calls)

```bash
cd backend
pip install -r requirements-dev.txt
pytest
```

Tests cover: route validation, schema clamping, body-size limits, mock provider, health endpoint.

---

## Configuration

### Backend (`.env`)

| Variable | Default | Description |
|---|---|---|
| `DEEPSEEK_API_KEY` | _(required)_ | Your DeepSeek API key. Set to `mock` for mock mode. |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | API base URL |
| `DEEPSEEK_MODEL` | `deepseek-chat` | Model name — verify in your account |
| `PORT` | `8787` | Port the backend binds to |

**To change the model:** Update `DEEPSEEK_MODEL` in `.env`. Verify the model name is available in your DeepSeek account. The model output is validated against a strict JSON schema regardless of which model is used.

### Extension settings (popup)

- **Sensitivity:** Low / Medium / High — adjusts the content-impact threshold for interventions
- **Pause/Resume** — stops/starts extraction and analysis
- **Clear session data** — resets in-memory session metrics

### Developer thresholds (`extension/src/session/intervention-policy.ts`)

These are initial experimental values — tune them during testing:

| Setting | Default | Effect |
|---|---|---|
| `MIN_ITEMS_REQUIRED` | 5 | Items needed before intervention can fire |
| Minimum session (settings) | 5 minutes | Session must be at least this long |
| Medium sensitivity threshold | 0.55 | Recent impact must exceed this |
| `HIGH_EXPOSURE_RATIO` | 0.6 | Negative-exposure fraction that triggers pattern gate |
| Cooldown (settings) | 10 minutes | Wait after dismissal |
| Max prompts per session (settings) | 2 | Maximum interventions per session |

---

## Supported sites (V0.1)

| Site | Status |
|---|---|
| YouTube Shorts (`youtube.com/shorts/*`) | ✅ Supported |
| YouTube (standard) | ❌ Not supported in V0.1 |
| Reddit, X, Instagram | ❌ Planned for later milestones |

---

## Known limitations

- **YouTube DOM changes frequently.** The title/description selectors may break if YouTube updates its layout. Check `extension/src/content/adapters/youtube-shorts.ts` and update selectors if extraction stops working.
- **Service worker suspension.** MV3 service workers can be suspended. Session state resets on suspension. V0.2 can persist state to `chrome.storage.session`.
- **Caption extraction** is not implemented in V0.1. Only the visible title and description are extracted.
- **V0.1 is not on-device.** Text is sent to DeepSeek's cloud API via the local backend.
- **Watch duration** is not measured in V0.1 as it cannot be reliably observed without video element instrumentation.
- **One negative item does not trigger an intervention.** The policy requires sustained patterns (see gates above).

---

## Privacy

See [docs/privacy.md](docs/privacy.md) for a full breakdown of what is collected, where it goes, and your controls.

**Summary:**
- Raw extracted text is **never** stored by the extension
- The DeepSeek API key is **never** in the extension code
- Session metrics are in-memory only (cleared on session end)
- Only user settings are persisted locally via `chrome.storage.local`

---

## Development notes

### Adding a new site adapter

1. Create `extension/src/content/adapters/<site>.ts`
2. Implement the same extraction interface as `youtube-shorts.ts`
3. Register it in `site-detection.ts`
4. Add a host permission in `manifest.json`
5. Update `AnalyzeRequest.source` pattern in the backend schema

### Switching AI providers

1. Implement the `AIProvider` abstract class in `backend/src/providers/`
2. Update `classify_content.py` to select the new provider
3. The rest of the pipeline (validation, session engine, UI) is provider-agnostic

---

## Architecture

See [docs/architecture.md](docs/architecture.md).
