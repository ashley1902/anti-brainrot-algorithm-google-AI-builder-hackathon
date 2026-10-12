/**
 * youtube-shorts.ts
 *
 * Site adapter for YouTube Shorts.
 *
 * Extraction strategy (in priority order):
 *   1. Video ID from URL  → used as the deduplication key (most reliable)
 *   2. document.title     → primary text source (consistently contains video title)
 *   3. DOM selectors      → supplement with description text if available
 *
 * YouTube's DOM changes frequently. This adapter uses defensive selectors
 * and fails gracefully when elements are unavailable.
 */

import type { ExtractionResult } from "../../types";

// ─── URL helpers ──────────────────────────────────────────────────────────────

/** Whether the current URL is a YouTube Shorts URL. */
export function isYouTubeShorts(): boolean {
  return (
    window.location.hostname === "www.youtube.com" &&
    window.location.pathname.startsWith("/shorts/")
  );
}

/** Extract the video ID from the current Shorts URL. Returns "" if not found. */
export function getCurrentShortId(): string {
  const match = window.location.pathname.match(/^\/shorts\/([^/?#]+)/);
  return match ? match[1] : "";
}

/** Whether the current URL is on YouTube at all. */
export function isYouTube(): boolean {
  return window.location.hostname === "www.youtube.com";
}

// ─── Fingerprint ──────────────────────────────────────────────────────────────

/**
 * Primary dedup key = video ID from URL.
 * This is stable across DOM mutations and never changes for the same Short.
 */
export function computeFingerprint(videoId: string, text: string): string {
  if (videoId) return `yt-short-${videoId}`;
  // Fallback: djb2 hash of text if videoId unavailable
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

// ─── Text cleaning ────────────────────────────────────────────────────────────

const MAX_TEXT_CHARS = 800;

/**
 * YouTube UI strings that are never video content.
 * If extraction returns only these words, treat as unavailable.
 */
const UI_BLOCKLIST = new Set([
  "comments", "subscribe", "like", "share", "follow",
  "shorts", "youtube", "home", "explore", "notifications",
  "search", "trending", "subscriptions", "library", "history",
]);

function isUsableText(text: string): boolean {
  if (!text || text.length < 4) return false;
  const lower = text.toLowerCase().trim();
  if (UI_BLOCKLIST.has(lower)) return false;
  return true;
}

function cleanTitle(raw: string): string {
  return raw
    .replace(/^\(\d+\)\s*/, "")              // strip notification badge "(4) "
    .replace(/\s*[-|]\s*YouTube\s*$/i, "")   // strip "- YouTube" suffix
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

function cleanText(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

// ─── Music extraction ─────────────────────────────────────────────────────────

/**
 * DOM selectors for the audio/music overlay shown at the bottom of a Short.
 * YouTube's DOM evolves; try multiple selectors defensively.
 */
const MUSIC_DOM_SELECTORS = [
  // Active reel player header (most reliable as of mid-2026)
  "ytd-reel-video-renderer[is-active] ytd-reel-player-header-renderer yt-formatted-string",
  "ytd-reel-player-header-renderer .title.ytd-reel-player-header-renderer yt-formatted-string",
  // Generic fallbacks
  ".ytd-reel-player-overlay-renderer .song-title yt-formatted-string",
  "ytd-reel-player-overlay-renderer yt-formatted-string.song-title",
  "#reel-player-overlay-renderer yt-formatted-string",
];

function extractMusicFromYT(): string {
  // 1. Try DOM selectors
  for (const sel of MUSIC_DOM_SELECTORS) {
    const text = document.querySelector(sel)?.textContent?.trim();
    if (text && text.length > 2) {
      if (/original\s*(audio|sound)/i.test(text)) return "";
      return text;
    }
  }

  // 2. Try window.ytInitialData for music info
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ytData = (window as any).ytInitialData;
    if (!ytData) return "";

    // YouTube buries music info in playerOverlays or reelWatchSequenceRenderer
    // Walk common paths; bail gracefully if structure differs
    const overlays =
      ytData?.playerOverlays?.playerOverlayRenderer?.decoratedPlayerBarRenderer
        ?.decoratedPlayerBarRenderer?.playerBar?.multiMarkersPlayerBarRenderer
        ?.markersMap ?? [];

    for (const marker of overlays) {
      const title: string | undefined =
        marker?.value?.chapters?.[0]?.chapterRenderer?.title?.simpleText;
      if (title && !/original\s*(audio|sound)/i.test(title)) return title;
    }
  } catch {
    // ytInitialData structure varies — fail silently
  }

  return "";
}

// ─── Comment extraction ───────────────────────────────────────────────────────

/**
 * Extract top comments from window.ytInitialData.
 *
 * YouTube embeds initial page data (including some comments) in a JS variable.
 * Comments live in engagementPanels → sectionListRenderer → itemSectionRenderer.
 * This is best-effort; on Shorts the panel may be empty on initial load.
 */
function extractCommentsFromYtData(): string[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ytData = (window as any).ytInitialData;
    if (!ytData) return [];

    const comments: string[] = [];

    // Walk engagementPanels — comments panel identifier = "comment-item-section"
    const panels: unknown[] = ytData?.engagementPanels ?? [];
    for (const panel of panels) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = panel as any;
      const sectionContents: unknown[] =
        p?.engagementPanelSectionListRenderer?.content?.sectionListRenderer?.contents ?? [];

      for (const section of sectionContents) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const items: unknown[] = (section as any)?.itemSectionRenderer?.contents ?? [];
        for (const item of items) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const commentRenderer = (item as any)?.commentThreadRenderer?.comment?.commentRenderer;
          if (!commentRenderer) continue;

          const runs: Array<{ text: string }> = commentRenderer?.contentText?.runs ?? [];
          const text = runs.map((r) => r.text).join("").trim();

          if (text && text.length >= 5 && text.length <= 400) {
            comments.push(text);
            if (comments.length >= 5) return comments;
          }
        }
      }
    }

    return comments;
  } catch {
    return [];
  }
}

// ─── Extraction ───────────────────────────────────────────────────────────────

/**
 * Extract visible title/description from the current YouTube Shorts page.
 *
 * Primary strategy: document.title (consistently contains the video title,
 * even when DOM selectors break due to YouTube layout changes).
 *
 * Secondary: DOM selectors for description/caption to enrich the text.
 */
export function extractYouTubeShortsContent(): ExtractionResult {
  const observedAt = Date.now();

  if (!isYouTubeShorts()) {
    return {
      supported: false,
      contentAvailable: false,
      text: "",
      sourceType: "unknown",
      fingerprint: "",
      observedAt,
    };
  }

  const videoId = getCurrentShortId();
  const parts: string[] = [];

  // ── 1. document.title (most reliable) ──────────────────────────────────────
  if (document.title) {
    const title = cleanTitle(document.title);
    if (isUsableText(title)) {
      parts.push(title);
    }
  }

  // ── 2. DOM title selectors (fallback/supplement if doc.title failed) ────────
  if (parts.length === 0) {
    const titleSelectors = [
      "ytd-reel-video-renderer[is-active] h2.title yt-formatted-string",
      "ytd-reel-video-renderer[is-active] #title yt-formatted-string",
      "#title yt-formatted-string",
      "h2.title yt-formatted-string",
      "yt-dynamic-text-view-model h2",
      "ytd-shorts-video-title-entity-header-renderer h2",
    ];
    for (const sel of titleSelectors) {
      const el = document.querySelector(sel);
      const txt = el?.textContent?.trim();
      if (txt && isUsableText(txt)) {
        parts.push(cleanText(txt));
        break;
      }
    }
  }

  // ── 3. Description / caption (optional supplement) ─────────────────────────
  const descSelectors = [
    "ytd-reel-video-renderer[is-active] #description-inline-expander",
    "ytd-reel-video-renderer[is-active] yt-attributed-string",
    "ytd-structured-description-content-renderer",
  ];
  for (const sel of descSelectors) {
    const el = document.querySelector(sel);
    const txt = el?.textContent?.trim();
    if (txt && isUsableText(txt) && txt.length > 10) {
      // Only add if it's meaningfully different from the title
      const titleLower = (parts[0] ?? "").toLowerCase();
      if (!titleLower.includes(txt.slice(0, 15).toLowerCase())) {
        parts.push(cleanText(txt).slice(0, 200));
      }
      break;
    }
  }

  const combined = parts.join(" — ").trim();

  if (!combined || !isUsableText(combined)) {
    return {
      supported: true,
      contentAvailable: false,
      text: "",
      sourceType: "youtube_shorts",
      fingerprint: videoId ? `yt-short-${videoId}` : "",
      observedAt,
    };
  }

  const fingerprint = computeFingerprint(videoId, combined);

  // Extract audio track + top comments (both best-effort, fail silently)
  const musicInfo = extractMusicFromYT() || undefined;
  const rawComments = extractCommentsFromYtData();

  if (musicInfo) console.log(`[ABR-YT] 🎵 Music: ${musicInfo}`);
  if (rawComments.length) console.log(`[ABR-YT] 💬 Comments (${rawComments.length}): ${rawComments[0]?.slice(0, 60)}`);

  return {
    supported: true,
    contentAvailable: true,
    text: combined,
    sourceType: "youtube_shorts",
    fingerprint,
    observedAt,
    musicInfo,
    topComments: rawComments.length > 0 ? rawComments : undefined,
  };
}
