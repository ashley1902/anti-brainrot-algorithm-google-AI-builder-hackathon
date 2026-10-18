# Privacy Notice  Anti Brain Rot V0.1

## What is analyzed

The extension reads limited visible text from supported social-media pages:
- Video title (from the YouTube Shorts player)
- Visible description/caption text

It does **not** read:
- Your username or account identity
- Private messages
- Full comment feeds
- Browser history, cookies, or authentication tokens
- Audio or video frames

## Where data goes

Extracted text is sent from the extension's service worker to a **cloud backend** hosted on Google Cloud Run. The backend calls the **Google Gemini API** (`gemini-2.0-flash-lite`) to classify the content.

**Text leaves your device** to reach Google's servers for AI classification. You should review [Google's Privacy Policy](https://policies.google.com/privacy) and [Gemini API Terms](https://ai.google.dev/terms) before real-world use. No extracted text is stored by the backend — it is discarded immediately after classification.

## What is stored

| Data | Stored where | How long |
|---|---|---|
| Extracted text | **Never stored**  discarded after analysis | Never |
| AI classification features (numbers, tags) | Extension memory only | Until session ends or extension restarts |
| Session metrics (duration, item count) | Extension memory only | Until session ends |
| User settings | `chrome.storage.local` (on-device) | Until you clear or uninstall |
| Gemini API key | Google Cloud Run environment variable (server-side only) | You control |
| API key in extension | **Never**  by design | Not applicable |

## What is never collected

- Your mood, emotions, or mental health state
- Personal identifiers
- Account data
- Analytics or telemetry
- Raw screenshots or audio

## Your controls

- **Pause / Resume** monitoring at any time via the popup
- **Clear session data** via the popup  clears in-memory session metrics
- **Disable monitoring**  stops all extraction and analysis
- **Clear settings**  remove extension storage via Chrome's extension settings

## Language

Scores shown in the popup are content-characteristic **estimates**, not assessments of your mood, mental state, or wellbeing. Anti Brain Rot is not a medical device and does not diagnose or treat any condition.
