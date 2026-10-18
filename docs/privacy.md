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

In V0.1, extracted text is sent from the extension's service worker to a **localhost backend** running on your own machine. The localhost backend then calls the **DeepSeek API** (a cloud service) to classify the content.

**V0.1 is not fully on-device.** Text leaves your device to reach DeepSeek's servers. You should review DeepSeek's current data-handling and privacy terms before real-world use.

## What is stored

| Data | Stored where | How long |
|---|---|---|
| Extracted text | **Never stored**  discarded after analysis | Never |
| AI classification features (numbers, tags) | Extension memory only | Until session ends or extension restarts |
| Session metrics (duration, item count) | Extension memory only | Until session ends |
| User settings | `chrome.storage.local` (on-device) | Until you clear or uninstall |
| DeepSeek API key | Backend `.env` file on your machine | You control |
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
