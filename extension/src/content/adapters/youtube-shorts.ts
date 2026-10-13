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

/**
 * Strip YouTube engagement metadata that sometimes leaks into DOM text.
 * Examples caught: "6kLikes339kViews9 Oct2026", "1.2M views", "5 Sept 2026"
 */
function stripEngagementMetadata(text: string): string {
  return text
    // Likes / views counts (e.g. "6kLikes", "1.2MLikes", "339kViews")
    .replace(/[\d,.]+\s*[kKmMbB]?\s*likes?/gi, "")
    .replace(/[\d,.]+\s*[kKmMbB]?\s*views?/gi, "")
    // Dates concatenated without spaces ("9 Oct2026", "9Oct2026", "Sept 2026")
    .replace(/\d{1,2}\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s*\d{4}/gi, "")
    .replace(/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s*\d{4}/gi, "")
    // Collapse leftover whitespace
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Music extraction ─────────────────────────────────────────────────────────

/**
 * The reel renderer for the Short currently on screen. YouTube now reuses a
 * single ytd-reel-video-renderer and no longer sets [is-active], so pick the
 * one crossing the vertical centre of the viewport.
 */
function getActiveReel(): ParentNode {
  const reels = Array.from(document.querySelectorAll("ytd-reel-video-renderer"));
  const mid = window.innerHeight / 2;
  const visible = reels.find((el) => {
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.top < mid && r.bottom > mid;
  });
  return visible ?? reels[0] ?? document;
}

const AUDIO_CHIPS = "yt-reel-carousel-view-model button-view-model";

// ─── Audio stream URL (for Whisper transcription) ─────────────────────────────

/**
 * Parse ytInitialPlayerResponse from the page's <script> tags.
 * We only extract the adaptiveFormats array to avoid parsing the full
 * (multi-MB) player response JSON.
 */
function extractYtAudioStreamUrl(): string {
  try {
    const scripts = Array.from(
      document.querySelectorAll<HTMLScriptElement>("script")
    );
    for (const script of scripts) {
      const text = script.textContent ?? "";
      if (!text.includes("ytInitialPlayerResponse")) continue;
      if (!text.includes("adaptiveFormats")) continue;

      // Find and extract just the adaptiveFormats array
      const afIdx = text.indexOf('"adaptiveFormats":');
      if (afIdx === -1) continue;
      const arrStart = text.indexOf("[", afIdx);
      if (arrStart === -1) continue;

      // Bracket counter to find end of the array
      let depth = 0;
      let inStr = false;
      let escape = false;
      let end = -1;
      const slice = text.slice(arrStart);
      const limit = Math.min(slice.length, 300_000); // safety cap

      for (let i = 0; i < limit; i++) {
        const ch = slice[i];
        if (escape) { escape = false; continue; }
        if (ch === "\\" && inStr) { escape = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === "[" || ch === "{") depth++;
        else if (ch === "]" || ch === "}") {
          depth--;
          if (depth === 0) { end = i + 1; break; }
        }
      }
      if (end === -1) continue;

      type AdaptiveFormat = {
        itag?: number;
        mimeType?: string;
        url?: string;
        signatureCipher?: string;
      };

      const formats = JSON.parse(slice.slice(0, end)) as AdaptiveFormat[];

      // Audio-only streams have no width/height and mimeType starts with "audio/"
      // Skip cipher-protected streams (we can't decrypt them without the player JS)
      const audioFormats = formats.filter(
        (f) => f.mimeType?.startsWith("audio/") && f.url && !f.signatureCipher
      );

      if (audioFormats.length === 0) return "";

      // Prefer itag 140 (m4a/AAC, widest ffmpeg/whisper compatibility)
      const preferred =
        audioFormats.find((f) => f.itag === 140) ?? audioFormats[0];
      return preferred?.url ?? "";
    }
  } catch (e) {
    console.log("[ABR-YT] 🎙️  Audio URL extraction error:", e);
  }
  return "";
}

/**
 * Read ytInitialData JSON from the embedded <script> tag.
 * Content scripts run in an isolated JS world and cannot access
 * window.ytInitialData set by page scripts, but can read script tag text.
 */
function readYtInitialData(): unknown {
  try {
    const scripts = Array.from(
      document.querySelectorAll<HTMLScriptElement>("script")
    );
    for (const script of scripts) {
      const text = script.textContent ?? "";
      const idx = text.indexOf("ytInitialData");
      if (idx === -1) continue;

      // Find the JSON object starting after "ytInitialData ="
      const eqIdx = text.indexOf("=", idx);
      if (eqIdx === -1) continue;
      const jsonStart = text.indexOf("{", eqIdx);
      if (jsonStart === -1) continue;

      // The script is typically: var ytInitialData = {...};
      // Find last semicolon to trim the trailing ";window['ytInitialData']..." noise
      const jsonStr = text.slice(jsonStart);
      // JSON.parse will stop at the first complete object — use a bracket counter
      let depth = 0;
      let inStr = false;
      let escape = false;
      let end = -1;
      for (let i = 0; i < jsonStr.length; i++) {
        const ch = jsonStr[i];
        if (escape) { escape = false; continue; }
        if (ch === "\\" && inStr) { escape = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) { end = i + 1; break; }
        }
      }
      if (end === -1) continue;

      return JSON.parse(jsonStr.slice(0, end));
    }
  } catch {
    // Fail silently — script tags may vary
  }
  return null;
}

/**
 * The audio card is a <button> chip in the active Short's carousel whose text
 * is "Song · Artist". Other carousel chips (related videos) are <a href="/watch?v=">
 * links without the middle dot.
 *
 * ytInitialData is deliberately not used: it reflects only the first Short
 * loaded and would attach the same song to every subsequent Short.
 */
let lastMusicText = "";
let lastMusicVideoId = "";

function extractMusicFromYT(videoId: string): string {
  const chips = Array.from(getActiveReel().querySelectorAll<HTMLElement>(AUDIO_CHIPS));

  for (const chip of chips) {
    if (chip.querySelector("a[href*='/watch']")) continue;
    const text = chip.innerText.trim();
    if (!text.includes("\u00B7")) continue;

    console.log(`[ABR-YT] 🎵 Audio chip: "${text}"`);
    if (text === lastMusicText && videoId !== lastMusicVideoId) return "";
    lastMusicText = text;
    lastMusicVideoId = videoId;
    if (/original\s*(audio|sound)/i.test(text)) return "";

    const [song, ...artistParts] = text.split("\u00B7").map((s) => s.trim());
    const artist = artistParts.join(", ");
    return (artist ? `${artist} - ${song}` : song).slice(0, 150);
  }

  console.log(
    `[ABR-YT] 🎵 No audio chip. Carousel chips: ${JSON.stringify(chips.map((c) => c.innerText.trim()))}`
  );
  return "";
}

// ─── Comment extraction ───────────────────────────────────────────────────────

/**
 * Extract top comments from the YouTube comments panel.
 * Confirmed DOM structure via live inspection on Shorts:
 *   - Panel: ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]
 *   - Each comment: ytd-comment-thread-renderer
 *   - innerText per thread: "@username\nN time ago\ncomment text\n[like_count]\nReply\n[· N replies]"
 *   - Like count is a bare number (e.g. "1", "2.3K") on its own line just before "Reply"
 * The panel only exists when the user has opened it — returns [] gracefully if not.
 */
function extractCommentsFromYtPanel(): string[] {
  const panel = document.querySelector<HTMLElement>(
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]'
  );
  if (!panel) return [];

  const threads = Array.from(
    panel.querySelectorAll<HTMLElement>("ytd-comment-thread-renderer")
  );
  if (threads.length === 0) return [];

  // Lines to skip when parsing a thread's innerText
  const JUNK_LINES = new Set([
    "reply", "show less", "read more", "add a comment…", "comments",
    "top is selected, so you'll see featured comments",
  ]);
  const TIMESTAMP_RE = /^\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i;
  // Like count: bare number or abbreviated (e.g. "1", "2.3K", "1,234")
  const LIKE_COUNT_RE = /^[\d,.]+[KkMm]?$/;

  function parseLikeCount(s: string): number {
    const lower = s.toLowerCase();
    const base = parseFloat(s.replace(/,/g, ""));
    if (isNaN(base)) return 0;
    if (lower.endsWith("k")) return Math.round(base * 1_000);
    if (lower.endsWith("m")) return Math.round(base * 1_000_000);
    return Math.round(base);
  }

  const collected: Array<{ text: string; likes: number }> = [];

  for (const thread of threads) {
    const lines = (thread.innerText ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    // Find @username line — marks start of comment block
    const usernameIdx = lines.findIndex((l) => l.startsWith("@"));
    if (usernameIdx === -1) continue;

    // Find "Reply" — marks end of comment block
    const replyIdx = lines.indexOf("Reply", usernameIdx);
    if (replyIdx === -1) continue;

    // All lines between username and Reply (exclusive)
    const between = lines.slice(usernameIdx + 1, replyIdx).filter((l) => {
      const lo = l.toLowerCase();
      return !TIMESTAMP_RE.test(l) && !JUNK_LINES.has(lo) && !lo.startsWith("translate");
    });

    // If last remaining line is a bare number it's the like count
    let likes = 0;
    let textLines = between;
    if (between.length > 0 && LIKE_COUNT_RE.test(between[between.length - 1])) {
      likes = parseLikeCount(between[between.length - 1]);
      textLines = between.slice(0, -1);
    }

    const text = textLines.join(" ").replace(/\s+/g, " ").trim();
    if (text.length >= 4 && text.length <= 400) {
      collected.push({ text, likes });
    }
  }

  console.log(`[ABR-YT] 💬 Found ${collected.length} comments from panel`);

  // Sort by likes desc — comments with 0 likes keep their original order
  return collected
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 5)
    .map((c) => c.text);
}

// ─── Extraction ───────────────────────────────────────────────────────────────

let lastDescriptionText = "";
let lastDescriptionVideoId = "";

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
      "yt-shorts-video-title-view-model",
      "h2.title yt-formatted-string",
      "#title yt-formatted-string",
      "yt-dynamic-text-view-model h2",
      "ytd-shorts-video-title-entity-header-renderer h2",
    ];
    for (const sel of titleSelectors) {
      const el = getActiveReel().querySelector(sel);
      const txt = el?.textContent?.trim();
      if (txt && isUsableText(txt)) {
        parts.push(cleanText(txt));
        break;
      }
    }
  }

  // ── 3. Description / caption (optional supplement) ─────────────────────────
  // NOTE: yt-attributed-string is intentionally excluded — it captures the full
  // container including author name, likes, views, and date, producing junk like
  // "6kLikes339kViews9 Oct2026". Only use specific, scoped selectors.
  // ytd-structured-description-content-renderer is also excluded — it is a single
  // shared panel that keeps the first-loaded Short's description indefinitely.
  const descSelectors = [
    "#description-inline-expander",
  ];
  for (const sel of descSelectors) {
    const el = getActiveReel().querySelector(sel);
    const rawTxt = el?.textContent?.trim();
    if (!rawTxt || !isUsableText(rawTxt) || rawTxt.length <= 10) continue;
    if (rawTxt === lastDescriptionText && videoId !== lastDescriptionVideoId) continue;
    lastDescriptionText = rawTxt;
    lastDescriptionVideoId = videoId;

    const txt = stripEngagementMetadata(rawTxt);
    if (!txt || !isUsableText(txt)) continue;

    // Only add if it's meaningfully different from the title
    const titleLower = (parts[0] ?? "").toLowerCase();
    if (!titleLower.includes(txt.slice(0, 15).toLowerCase())) {
      parts.push(cleanText(txt).slice(0, 200));
    }
    break;
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
  const musicInfo = extractMusicFromYT(videoId) || undefined;
  const rawComments = extractCommentsFromYtPanel();

  // Only extract audio stream URL for Whisper when there is no identifiable
  // music track (i.e. original audio — vlogs, comedy, talking-head content).
  const audioUrl = !musicInfo ? extractYtAudioStreamUrl() || undefined : undefined;

  if (musicInfo) console.log(`[ABR-YT] 🎵 Music: ${musicInfo}`);
  if (audioUrl)  console.log("[ABR-YT] 🎙️  Audio stream URL found (will transcribe)");
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
    audioUrl,
  };
}
