/**
 * content.ts
 *
 * Main content script.
 *
 * Responsibilities:
 *   1. Detect page type (YouTube Shorts / Instagram Reels / unsupported).
 *   2. Observe URL/DOM changes; extract and send content to service worker.
 *   3. Receive SHOW_INTERVENTION from service worker; render overlay.
 *   4. For Instagram: wait for the caption DOM to actually update before
 *      extracting — prevents sending the previous reel's caption for the
 *      current reel.
 *
 * Raw extracted text is discarded after being sent. Never persisted locally.
 */

import { extractYouTubeShortsContent, isYouTubeShorts } from "./adapters/youtube-shorts";
import { extractInstagramReelsContent, isInstagramReels } from "./adapters/instagram-reels";
import { showInterventionOverlay } from "./intervention-ui";
import { detectCurrentPage } from "./site-detection";
import type { ExtractionResult, ExtensionMessage } from "../types";

// ─── Rate limiting ────────────────────────────────────────────────────────────
const MIN_REQUEST_INTERVAL_MS = 2000;
let lastRequestAt = 0;

// ─── Observer / interval handles ─────────────────────────────────────────────
let mutationObserver: MutationObserver | null = null;
let navigationCheckInterval: ReturnType<typeof setInterval> | null = null;
let lastPath = window.location.pathname;
let monitoring = true;

// ─── YouTube debounce ─────────────────────────────────────────────────────────
const DEBOUNCE_MS = 600;
const STABILIZE_YT_MS = 600;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleExtraction(): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => attemptExtraction(), DEBOUNCE_MS);
}

// ─── Instagram: DOM hash watching ─────────────────────────────────────────────
/**
 * Fingerprint of all meaningful span[dir="auto"] text visible on the page.
 * Changes when Instagram swaps in a new reel's caption DOM nodes.
 *
 * Only spans > 20 chars to ignore like counts / short UI labels.
 */
function captionStateHash(): string {
  return Array.from(document.querySelectorAll("span[dir='auto']"))
    .map((el) => el.textContent?.trim() ?? "")
    .filter((t) => t.length > 20)
    .join("|");
}

/** Hash after the last successful Instagram extraction. */
let igLastCaptionHash = "";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll every 150 ms until captionStateHash() differs from previousHash,
 * or until maxWaitMs is exceeded.  When Instagram swipes to a new reel it
 * replaces the caption spans within ~300–2000 ms.
 */
async function waitForCaptionUpdate(
  previousHash: string,
  maxWaitMs = 4000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await sleep(150);
    if (captionStateHash() !== previousHash) return;
  }
  console.log(
    "[ABR] Caption DOM unchanged after timeout — proceeding with current state"
  );
}

// ─── Main extraction ──────────────────────────────────────────────────────────
async function attemptExtraction(): Promise<void> {
  if (!monitoring) return;

  // Don't analyze content when the user is on a different tab.
  // Prevents background-tab analysis consuming fingerprint slots so that
  // content is "already seen" when the user actually switches back.
  if (document.visibilityState !== "visible") return;

  const page = detectCurrentPage();
  if (!page.supported) return;

  const now = Date.now();
  if (now - lastRequestAt < MIN_REQUEST_INTERVAL_MS) return;

  let result: ExtractionResult;
  if (page.source === "youtube_shorts") {
    result = extractYouTubeShortsContent();
  } else {
    result = await extractInstagramReelsContent();
  }

  if (!result.contentAvailable || !result.text) {
    console.log("[ABR] Content not available on this page");
    return;
  }

  console.log(
    `[ABR] Extracted: "${result.text.slice(0, 80)}" | fingerprint: ${result.fingerprint}`
  );

  // Sync caption hash AFTER a successful Instagram extraction
  if (page.source === "instagram_reels") {
    igLastCaptionHash = captionStateHash();
  }

  lastRequestAt = now;

  const msg: ExtensionMessage = {
    type: "CONTENT_DETECTED",
    payload: {
      text: result.text,
      source: result.sourceType as "youtube_shorts" | "instagram_reels",
      fingerprint: result.fingerprint,
      musicInfo: result.musicInfo,
      topComments: result.topComments,
    },
  };

  try {
    await chrome.runtime.sendMessage(msg);
  } catch (err) {
    console.debug("[ABR] Could not send CONTENT_DETECTED:", err);
  }
}

// ─── Instagram navigation handler ─────────────────────────────────────────────
/**
 * Called after every Instagram URL change.
 *
 * 1. Capture the caption hash BEFORE the new reel loads.
 * 2. Wait until Instagram updates the DOM (hash changes).
 * 3. THEN extract — guaranteeing we read the new reel's caption, not the old one.
 */
async function handleInstagramNavigation(): Promise<void> {
  const hashBefore = igLastCaptionHash || captionStateHash();
  console.log("[ABR] Waiting for Instagram caption DOM to update…");
  await waitForCaptionUpdate(hashBefore);
  console.log("[ABR] DOM updated, extracting.");
  await attemptExtraction();
}

// ─── Mutation observer (YouTube only) ────────────────────────────────────────
// Instagram navigation is handled event-driven via handleInstagramNavigation.
// We still observe mutations for YouTube so new Shorts trigger extraction.
function startObserver(): void {
  if (mutationObserver) return;

  mutationObserver = new MutationObserver(() => {
    if (!monitoring) return;
    if (isInstagramReels()) return; // Instagram handled separately
    if (!isYouTubeShorts()) return;
    scheduleExtraction();
  });

  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: false,
    attributes: false,
  });
}

function stopObserver(): void {
  mutationObserver?.disconnect();
  mutationObserver = null;
}

// ─── URL navigation detection ─────────────────────────────────────────────────
function startNavigationCheck(): void {
  if (navigationCheckInterval) return;
  navigationCheckInterval = setInterval(() => {
    const currentPath = window.location.pathname;
    if (currentPath !== lastPath) {
      console.log(`[ABR] URL changed: ${lastPath} → ${currentPath}`);
      lastPath = currentPath;
      if (!monitoring) return;

      if (isInstagramReels()) {
        handleInstagramNavigation().catch(console.error);
      } else if (isYouTubeShorts()) {
        setTimeout(scheduleExtraction, STABILIZE_YT_MS);
      }
    }
  }, 300);
}

function stopNavigationCheck(): void {
  if (navigationCheckInterval) {
    clearInterval(navigationCheckInterval);
    navigationCheckInterval = null;
  }
}

// ─── Incoming messages ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    switch (message.type) {
      case "SHOW_INTERVENTION":
        showInterventionOverlay((action) => {
          const responseMsg: ExtensionMessage = {
            type: "INTERVENTION_RESPONSE",
            payload: { action },
          };
          chrome.runtime.sendMessage(responseMsg).catch(() => {});
        });
        break;

      case "SET_MONITORING":
        monitoring = message.payload.enabled;
        if (monitoring) {
          startObserver();
          startNavigationCheck();
        } else {
          stopObserver();
          stopNavigationCheck();
        }
        break;

      case "SESSION_SNAPSHOT_REQUEST":
        sendResponse({ ok: true });
        break;

      default:
        break;
    }
    return true;
  }
);

// ─── Tab visibility ───────────────────────────────────────────────────────────
// When the user switches back to this tab, trigger a fresh extraction so the
// currently-visible content gets analyzed even if no URL/DOM change fires.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !monitoring) return;

  if (isInstagramReels()) {
    // Use the full navigation handler so DOM hash check is respected
    handleInstagramNavigation().catch(console.error);
  } else if (isYouTubeShorts()) {
    scheduleExtraction();
  }
});

// ─── Bootstrap ────────────────────────────────────────────────────────────────
(function init() {
  const onSupportedPage = isYouTubeShorts() || isInstagramReels();
  if (!onSupportedPage) {
    startNavigationCheck();
    return;
  }

  startObserver();
  startNavigationCheck();

  if (isInstagramReels()) {
    // Initial page load: wait briefly for Instagram to render, then extract
    // and sync the hash baseline so future navigation changes are detectable.
    setTimeout(async () => {
      await attemptExtraction();
      igLastCaptionHash = captionStateHash(); // baseline after first extraction
    }, 1800);
  } else {
    setTimeout(() => scheduleExtraction(), STABILIZE_YT_MS);
  }
})();
