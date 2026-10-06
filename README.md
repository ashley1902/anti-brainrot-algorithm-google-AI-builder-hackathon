# 🧠 Anti Brain Rot — Chrome Extension

A privacy-conscious digital-wellbeing Chrome extension that watches what you scroll, classifies content using AI, and gently nudges you when it detects doomscrolling patterns.

**Supports:** YouTube Shorts · Instagram Reels  
**AI:** DeepSeek (via a local backend proxy — your API key never touches the extension)  
**Privacy:** No content is stored. All analysis is in-memory and clears when you close the browser.

---

## How it works

1. You scroll YouTube Shorts or Instagram Reels
2. The extension silently extracts the caption/title of each reel or short
3. It sends the text to a **local backend** running on your machine (never to any third-party directly)
4. The backend calls **DeepSeek AI** to classify emotional tone, anxiety signals, rage-bait, etc.
5. After enough data, if it detects a negative pattern (rising emotional intensity, high negative exposure), it shows a gentle dismissible prompt asking if you want to take a break

---

## Requirements

Before starting, make sure you have:

| Requirement | Version | How to install |
|---|---|---|
| **Chrome** | Any recent version | [chrome.google.com](https://www.google.com/chrome/) |
| **Node.js + npm** | Node ≥ 18, npm ≥ 9 | [nodejs.org](https://nodejs.org/) or `brew install node` |
| **Python** | ≥ 3.9 | [python.org](https://www.python.org/) or `brew install python` |
| **DeepSeek API key** | — | [platform.deepseek.com](https://platform.deepseek.com/) → API Keys |

> **Don't have Node.js?** On Mac run `brew install node`. On Windows download the installer from nodejs.org.  
> **Don't have Python?** On Mac run `brew install python`. On Windows download from python.org.

---

## Setup — Step by Step

### Step 1 — Clone the repo

```bash
git clone https://github.com/ashley1902/anti-brainrot-extension.git
cd anti-brainrot-extension
```

---

### Step 2 — Build the Chrome Extension (Frontend)

```bash
cd extension
npm install          # installs TypeScript, Webpack, etc.
npm run build        # compiles everything into extension/dist/
```

You should see:
```
webpack 5.x compiled successfully
```

The built extension is now in `extension/dist/`.

---

### Step 3 — Load the Extension into Chrome

1. Open Chrome and go to **`chrome://extensions/`**
2. Toggle on **Developer mode** (top-right corner)
3. Click **Load unpacked**
4. Select the **`extension/dist/`** folder inside this repo

You should see "Anti Brain Rot" appear in your extensions list with a 🧠 icon.  
Pin it to the toolbar for easy access.

---

### Step 4 — Set up the Python Backend

The backend is a local FastAPI server that proxies AI classification requests. It keeps your API key off the extension entirely.

```bash
# From the repo root
cd backend

# Create a virtual environment (keeps dependencies isolated)
python3 -m venv .venv

# Activate it
source .venv/bin/activate       # Mac / Linux
# .venv\Scripts\activate        # Windows

# Install dependencies
pip install -r requirements.txt
```

---

### Step 5 — Add your DeepSeek API key

```bash
# Still inside backend/
cp .env.example .env
```

Open `backend/.env` in any text editor and set your key:

```
DEEPSEEK_API_KEY=sk-your-actual-key-here
```

> **No API key yet?** Go to [platform.deepseek.com](https://platform.deepseek.com/), sign up, and generate a key under **API Keys**. DeepSeek has free credits for new accounts.

> **Just want to test without an API key?** Set `DEEPSEEK_API_KEY=mock` — the backend will return neutral placeholder scores so you can test the UI and session flow.

---

### Step 6 — Start the Backend

```bash
# From backend/ with .venv active
python -m src.server
```

You should see:
```
INFO: Uvicorn running on http://127.0.0.1:8787
INFO: Application startup complete.
```

To verify it's running, open a new terminal and run:
```bash
curl http://127.0.0.1:8787/health
# → {"status":"ok","version":"0.1.0"}
```

> **Keep this terminal open** while using the extension. The backend must be running for analysis to work.

---

### Step 7 — Use It!

1. Make sure the backend terminal is running
2. Open **YouTube Shorts** (`youtube.com/shorts/`) or **Instagram Reels** (`instagram.com/reels/`)
3. Click the 🧠 icon in the Chrome toolbar — you should see **"Monitoring: Active"**
4. Scroll through a few videos
5. Watch the popup update with **Items Analyzed**, content impact scores, and topics

After scrolling ~5–10 pieces of content over 5+ minutes, if the AI detects a negative pattern, you'll see a gentle intervention prompt appear on screen.

---

## Project Structure

```
anti-brainrot-extension/
├── extension/                  Chrome Extension (TypeScript + Webpack)
│   ├── manifest.json           MV3 manifest
│   ├── src/
│   │   ├── background/         Service worker (message routing, session engine)
│   │   ├── content/            Content script + site adapters
│   │   │   └── adapters/
│   │   │       ├── youtube-shorts.ts    YouTube Shorts extraction
│   │   │       └── instagram-reels.ts   Instagram Reels extraction
│   │   ├── session/            Scoring, trajectory, intervention policy
│   │   ├── storage/            Settings (chrome.storage.local)
│   │   └── popup/              Popup UI (HTML + CSS + TS)
│   ├── tests/                  Unit tests (Vitest — no API calls)
│   └── dist/                   Built extension (git-ignored, generated by npm run build)
│
├── backend/                    Local AI proxy (Python + FastAPI)
│   ├── src/
│   │   ├── providers/          AI provider interface + DeepSeek + Mock
│   │   ├── schemas/            Pydantic request/response models
│   │   ├── routes/             FastAPI route handlers
│   │   └── services/           Classification orchestration
│   ├── tests/                  pytest tests (mock provider, no API calls)
│   ├── .env.example            Template — copy to .env and add your key
│   └── requirements.txt        Python dependencies
│
└── docs/                       Architecture + privacy documentation
```

---

## Running Tests

### Extension (TypeScript — Vitest)

```bash
cd extension
npm test
```

Covers: content-impact scoring formula, trajectory (OLS slope), intervention policy state machine.

### Backend (Python — pytest)

```bash
cd backend
source .venv/bin/activate
pip install -r requirements-dev.txt
pytest
```

Covers: API route validation, Pydantic schema clamping, mock provider, health endpoint.

---

## Configuration

### Backend (`backend/.env`)

| Variable | Default | Description |
|---|---|---|
| `DEEPSEEK_API_KEY` | _(required)_ | Your DeepSeek key. Use `mock` for offline testing. |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | API base URL |
| `DEEPSEEK_MODEL` | `deepseek-chat` | Model name |
| `PORT` | `8787` | Port the backend listens on |

### Extension popup controls

| Control | What it does |
|---|---|
| **Pause / Resume** | Stops or restarts content extraction |
| **Sensitivity** | Low / Medium / High — adjusts how quickly interventions trigger |
| **Clear session** | Resets all in-memory data for this session |

---

## Supported Sites

| Site | Status |
|---|---|
| YouTube Shorts (`youtube.com/shorts/*`) | ✅ Fully supported |
| Instagram Reels (`instagram.com/reels/*`) | ✅ Fully supported |
| Instagram direct reel (`instagram.com/reel/ID/`) | ✅ Fully supported |
| TikTok, Reddit, X/Twitter | 🔜 Planned |

---

## Privacy

- **No content is ever stored** — extracted text is discarded immediately after the AI call
- **Your DeepSeek API key lives only in `backend/.env`** — it never touches the extension
- **Session data is in-memory only** — clears when you close the browser
- **Only your settings** (sensitivity, paused state) are persisted via `chrome.storage.local`

See [docs/privacy.md](docs/privacy.md) for the full breakdown.

---

## Troubleshooting

**Extension shows "Backend unreachable"**  
→ Make sure the Python backend is running (`python -m src.server` in `backend/`)  
→ Check it's on port 8787: `curl http://127.0.0.1:8787/health`

**No content being analyzed after scrolling**  
→ Check the Chrome console (F12 → Console) for `[ABR]` logs  
→ Make sure you're on `youtube.com/shorts/` or `instagram.com/reels/`  
→ Try clicking "Clear session" in the popup and scrolling again

**Backend shows `DEEPSEEK_API_KEY not set`**  
→ Make sure you've created `backend/.env` (not just `.env.example`)  
→ The key must start with `sk-`

**Python `pip: command not found`**  
→ Use `python3 -m pip install -r requirements.txt` instead

**npm: command not found**  
→ Install Node.js from [nodejs.org](https://nodejs.org/) or run `brew install node`

---

## Architecture

See [docs/architecture.md](docs/architecture.md) for a detailed breakdown of the content extraction pipeline, session engine, and intervention policy.
