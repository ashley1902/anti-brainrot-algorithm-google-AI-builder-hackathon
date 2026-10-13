/**
 * service-worker.ts
 *
 * MV3 Service Worker — message router and API bridge.
 *
 * IMPORTANT: MV3 service workers can be suspended at any time.
 * Do NOT rely on module-level globals as the only session store.
 * The session engine lives here for V0.1, but is guarded by
 * chrome.storage.session for resilience. Session state is cleared
 * when the service worker restarts (i.e., per browser session).
 *
 * Responsibilities:
 *   1. Route messages between content script and popup.
 *   2. Call the localhost backend proxy for AI analysis.
 *   3. Maintain in-memory session engine (SessionManager).
 *   4. Evaluate intervention policy after each analysis.
 *   5. Send SHOW_INTERVENTION to the content script when policy fires.
 *   6. Enforce per-session request cap and cooldown.
 */

import { SessionManager } from "../session/session-manager";
import { loadSettings } from "../storage/settings";
import { computeContentImpact } from "../session/scoring";
import type { ContentFeatures, DailyLogEntry, ExtensionMessage, Settings } from "../types";
import { DEFAULT_SETTINGS } from "../types";

// ─── Session Engine ───────────────────────────────────────────────────────────
// NOTE: This is reset whenever the service worker is restarted.
// V0.1 accepts this limitation; V0.2 can persist to chrome.storage.session.
let sessionManager = new SessionManager(DEFAULT_SETTINGS);
let currentSettings: Settings = DEFAULT_SETTINGS;

// Per-session request cap
const MAX_REQUESTS_PER_SESSION = 60;
let requestsThisSession = 0;

// Global fingerprint dedup — survives content script restarts.
// Also persisted to chrome.storage.session so SW restarts within the same
// browser session don't re-analyze content already seen.
const seenFingerprints = new Set<string>();

// Text-level dedup — catches same caption text arriving with different
// fingerprints (e.g. multiple reels that use identical hashtag-only captions,
// or stale DOM giving a previous reel's text to a new reel's ID).
const seenTexts = new Set<string>();

function persistFingerprints(): void {
  // Fire-and-forget — don't block the message handler
  chrome.storage.session
    .set({ seenFingerprints: [...seenFingerprints] })
    .catch(() => {});
}

// ─── Initialise ───────────────────────────────────────────────────────────────
async function init(): Promise<void> {
  currentSettings = await loadSettings();
  sessionManager = new SessionManager(currentSettings);

  // Restore fingerprints from previous SW lifecycle (same browser session)
  try {
    const stored = await chrome.storage.session.get("seenFingerprints");
    if (Array.isArray(stored.seenFingerprints)) {
      (stored.seenFingerprints as string[]).forEach((f) =>
        seenFingerprints.add(f)
      );
      console.log(
        `[ABR SW] Restored ${seenFingerprints.size} fingerprints from session storage`
      );
    }
  } catch {
    // chrome.storage.session not available (older Chrome) — silent fallback
  }
}

init().catch(console.error);

// ─── Context enrichment ───────────────────────────────────────────────────────

/**
 * Build the enriched text to send to DeepSeek.
 * Appends audio track and top comments to the caption so the AI has
 * full context about the reel/short (Option A — all in one text field).
 */
function buildEnrichedText(
  caption: string,
  musicInfo?: string,
  topComments?: string[],
  transcript?: string
): string {
  const parts: string[] = [caption];

  if (musicInfo) {
    parts.push(`\n\nAudio track: "${musicInfo}"`);
  }

  if (transcript) {
    parts.push(`\n\nSpoken content (transcribed): "${transcript}"`);
  }

  if (topComments && topComments.length > 0) {
    const formatted = topComments
      .slice(0, 5)
      .map((c, i) => `  ${i + 1}. ${c}`)
      .join("\n");
    parts.push(`\n\nTop comments:\n${formatted}`);
  }

  return parts.join("").slice(0, 2000);
}

// ─── Transcribe call ──────────────────────────────────────────────────────────
const TRANSCRIBE_TIMEOUT_MS = 25000; // Whisper small CPU can take ~5–10s

async function callTranscribeBackend(
  audioUrl: string,
  source: string
): Promise<string> {
  const url = `${currentSettings.backendUrl}/api/transcribe`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio_url: audioUrl, source }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) {
      console.warn(`[ABR SW] Transcribe returned ${response.status}`);
      return "";
    }
    const data = (await response.json()) as { transcript: string };
    console.log(`[ABR SW] 🎙️  Transcript: "${(data.transcript ?? "").slice(0, 80)}"`);
    return data.transcript ?? "";
  } catch (err) {
    clearTimeout(timeout);
    if ((err as Error).name === "AbortError") {
      console.warn("[ABR SW] Transcribe request timed out.");
    } else {
      console.warn("[ABR SW] Transcribe request failed:", (err as Error).message);
    }
    return "";
  }
}

// ─── Backend call ─────────────────────────────────────────────────────────────
const ANALYSIS_TIMEOUT_MS = 12000;

async function callBackend(
  text: string,
  source: string
): Promise<ContentFeatures | null> {
  const url = `${currentSettings.backendUrl}/api/analyze`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, source }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`[ABR SW] Backend returned ${response.status}`);
      return null;
    }

    const data = (await response.json()) as ContentFeatures;
    return data;
  } catch (err) {
    clearTimeout(timeout);
    if ((err as Error).name === "AbortError") {
      console.warn("[ABR SW] Backend request timed out.");
    } else {
      console.warn("[ABR SW] Backend request failed:", (err as Error).message);
    }
    return null;
  }
}

// ─── Message handling ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    handleMessage(message, sender).then(sendResponse).catch((err) => {
      console.error("[ABR SW] Message handler error:", err);
      sendResponse({ ok: false });
    });
    return true; // async response
  }
);

async function handleMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender
): Promise<unknown> {
  switch (message.type) {
    case "CONTENT_DETECTED": {
      if (!currentSettings.enabled) return { ok: false, reason: "disabled" };
      if (requestsThisSession >= MAX_REQUESTS_PER_SESSION) {
        return { ok: false, reason: "request_cap_reached" };
      }

      const { text, source, fingerprint, musicInfo, topComments, audioUrl } = message.payload;

      // Dedup by URL fingerprint — survives content script restarts
      if (seenFingerprints.has(fingerprint)) {
        return { ok: false, reason: "duplicate" };
      }
      seenFingerprints.add(fingerprint);
      persistFingerprints();

      // Dedup by text — catches same caption on multiple reel IDs
      // (hashtag-only bait captions, stale DOM race conditions, etc.)
      if (seenTexts.has(text)) {
        return { ok: false, reason: "duplicate_text" };
      }
      seenTexts.add(text);

      requestsThisSession++;
      sessionManager.recordObservedItem();

      // Whisper transcription — only when no music track was identified
      // (original audio: vlogs, comedy, talking-head content, etc.)
      let transcript: string | undefined;
      if (!musicInfo && audioUrl) {
        console.log("[ABR SW] 🎙️  Original audio detected — requesting transcription…");
        const t = await callTranscribeBackend(audioUrl, source);
        if (t) transcript = t;
      }

      // Build enriched text: caption + [music | transcript] + comments
      const enrichedText = buildEnrichedText(text, musicInfo, topComments, transcript);

      const features = await callBackend(enrichedText, source);

      // Raw text is no longer needed after the API call; it was never persisted.

      if (features) {
        sessionManager.addAnalyzedItem(features, fingerprint);

        // ── Persist to daily analytics log ────────────────────────────────
        const todayKey = `dailyLog_${new Date().toISOString().slice(0, 10)}`;
        const entry: DailyLogEntry = {
          timestamp: Date.now(),
          source: source as "youtube_shorts" | "instagram_reels",
          impact: computeContentImpact(features),
          emotionalIntensity: features.emotionalIntensity,
          rageBait: features.rageBait,
          sadness: features.sadness,
          anxietyRelated: features.anxietyRelated,
          fomo: features.fomo,
          socialComparison: features.socialComparison,
          relationshipDistress: features.relationshipDistress,
          humor: features.humor,
          inspirational: features.inspirational,
          topicTags: features.topicTags,
        };
        chrome.storage.local.get(todayKey, (res) => {
          const existing: DailyLogEntry[] = res[todayKey] ?? [];
          chrome.storage.local.set({ [todayKey]: [...existing, entry] });
        });

        // Evaluate intervention policy
        const shouldPrompt = sessionManager.evaluateIntervention();
        if (shouldPrompt && sender.tab?.id !== undefined) {
          const msg: ExtensionMessage = { type: "SHOW_INTERVENTION" };
          chrome.tabs
            .sendMessage(sender.tab.id, msg)
            .catch(() => {});
        }
      }

      return { ok: true };
    }

    case "INTERVENTION_RESPONSE": {
      sessionManager.recordInterventionResponse(message.payload.action);
      return { ok: true };
    }

    case "SESSION_SNAPSHOT_REQUEST": {
      const snapshot = sessionManager.getSnapshot();
      const response: ExtensionMessage = {
        type: "SESSION_SNAPSHOT",
        payload: snapshot,
      };
      return response;
    }

    case "SET_MONITORING": {
      currentSettings.enabled = message.payload.enabled;
      if (message.payload.enabled) {
        sessionManager.resume();
      } else {
        sessionManager.pause();
      }
      // Persist updated settings
      const { saveSettings } = await import("../storage/settings");
      await saveSettings(currentSettings);
      // Forward to content script in active tab
      forwardToActiveTab(message);
      return { ok: true };
    }

    case "CLEAR_SESSION": {
      sessionManager.reset();
      requestsThisSession = 0;
      seenFingerprints.clear();
      seenTexts.clear();
      chrome.storage.session.remove("seenFingerprints").catch(() => {});
      return { ok: true };
    }

    default:
      return { ok: false, reason: "unknown_message_type" };
  }
}

async function forwardToActiveTab(message: ExtensionMessage): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined) {
      await chrome.tabs.sendMessage(tab.id, message);
    }
  } catch {
    // Tab may not have the content script.
  }
}
