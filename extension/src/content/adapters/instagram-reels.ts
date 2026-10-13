/**
 * instagram-reels.ts
 *
 * Site adapter for Instagram Reels (explore /reels/ and direct /reel/ID/).
 *
 * DOM STRUCTURE (confirmed via live inspection):
 *   Caption text lives inside a SPAN[dir="auto"] element.
 *   span[dir="auto"] also contains: usernames, music attributions,
 *   location tags, like counts, UI labels — so we need good filters.
 *
 * CORE STRATEGY:
 *   1. Collect all span[dir="auto"] with real text.
 *   2. Filter out junk (music, location, username, UI, numbers).
 *   3. Among survivors, prefer those VISIBLE IN THE VIEWPORT
 *      (= the currently playing reel's caption).
 *   4. Score by caption richness (hashtag count, emoji, length).
 *   5. Fall back to document.title on /reel/ID/ direct pages.
 */

import type { ExtractionResult } from "../../types";

// ─── URL helpers ──────────────────────────────────────────────────────────────

export function isInstagramReels(): boolean {
  const host = window.location.hostname;
  const path = window.location.pathname;
  return (
    (host === "www.instagram.com" || host === "instagram.com") &&
    (path.startsWith("/reels") || path.startsWith("/reel/"))
  );
}

export function isInstagram(): boolean {
  const host = window.location.hostname;
  return host === "www.instagram.com" || host === "instagram.com";
}

/** Extract reel ID from URL: /reel/ABC/ or /reels/ABC/ → "ABC" */
export function getCurrentReelId(): string {
  const match = window.location.pathname.match(/\/reels?\/([^/?#]+)/);
  return match ? match[1] : "";
}

// ─── Fingerprint ──────────────────────────────────────────────────────────────

export function computeFingerprint(reelId: string, text: string): string {
  if (reelId) return `ig-reel-${reelId}`;
  // Fallback hash for when we have text but no URL ID
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return `ig-hash-${hash.toString(16)}`;
}

// ─── Text filters ─────────────────────────────────────────────────────────────

const MAX_TEXT_CHARS = 800;

/** Known UI label words — sidebar nav, action buttons, etc. */
const UI_LABELS = new Set([
  "instagram", "reels", "explore", "home", "search",
  "notifications", "messages", "create", "profile",
  "like", "comment", "share", "save", "follow", "following",
  "more", "also from meta", "threads", "facebook",
]);

function isUILabel(text: string): boolean {
  return UI_LABELS.has(text.toLowerCase().trim());
}

/**
 * Music attribution: "Artist · Song Title"
 * Instagram renders these with U+00B7 (·) middle dot.
 */
function isMusicAttribution(text: string): boolean {
  // U+00B7 middle dot — used by Instagram for "Artist · Song"
  if (text.includes("\u00B7")) return true;
  // Fallback: looks like "JAŸ-Z · Empire State Of Mind (feat. Alicia Keys)"
  if (/^[^#\n]{1,60}\s[·•]\s/.test(text) && !text.includes("#")) return true;
  return false;
}

/**
 * Location tag: "City, Country" or "City, State"
 * Short, starts with capital, contains comma.
 */
function isLocationTag(text: string): boolean {
  if (text.length > 80) return false;
  if (!text.includes(",")) return false;
  // Must start with a capital letter and have no hashtags
  return /^[A-Z]/.test(text) && !text.includes("#");
}

/**
 * Instagram username: alphanumeric + dots + underscores only, no spaces.
 * e.g. "indian777_perico", "mayankk.negiii"
 */
function isUsername(text: string): boolean {
  if (text.length > 35) return false;
  return /^[a-zA-Z0-9._]+$/.test(text) && !text.includes(" ");
}

/**
 * Pure number or count: "30", "2,536", "4,168"
 */
function isCountOrNumber(text: string): boolean {
  return /^[\d,]+$/.test(text.trim());
}

/** Short bullet-prefixed label: "• AI content", "• Sponsored" */
function isBulletLabel(text: string): boolean {
  return /^[•·]/.test(text.trim()) && text.length < 50 && !text.includes("#");
}

/**
 * Captions that are ONLY hashtags and/or @mentions — no readable content.
 * e.g. "#fyp #reels #viral #explore #trending"
 *      "@artist1 @artist2" (no message)
 */
function isHashtagsOrMentionsOnly(text: string): boolean {
  const stripped = text
    .replace(/#[\w\u0900-\u097F]+/g, "") // remove #hashtags (including Hindi/Unicode)
    .replace(/@[\w.]+/g, "")              // remove @mentions
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length < 5;
}

/** Copyright / legal footer text. */
function isCopyrightText(text: string): boolean {
  return /^©\s*\d{4}|^copyright\s/i.test(text.trim());
}

function isJunk(text: string): boolean {
  if (!text || text.length < 10) return true;
  if (isUILabel(text)) return true;
  if (isMusicAttribution(text)) return true; // captured separately via extractMusicFromDOM()
  if (isLocationTag(text)) return true;
  if (isUsername(text)) return true;
  if (isCountOrNumber(text)) return true;
  if (isBulletLabel(text)) return true;
  if (isHashtagsOrMentionsOnly(text)) return true;
  if (isCopyrightText(text)) return true;
  return false;
}

// ─── Music extraction ─────────────────────────────────────────────────────────

/**
 * Parse a music attribution string like "JAŸ-Z · Empire State Of Mind"
 * into a "Artist - Song" format.  Returns "" for original audio.
 */
function formatMusicInfo(raw: string): string {
  if (/original\s*(audio|sound)/i.test(raw)) return "";
  const parts = raw.split("\u00B7").map((s) => s.trim()); // split on U+00B7 middle dot
  if (parts.length >= 2) {
    const artist = parts[0];
    const song = parts.slice(1).join(" - ");
    if (/original\s*(audio|sound)/i.test(artist) || /original\s*(audio|sound)/i.test(song)) {
      return "";
    }
    return `${artist} - ${song}`;
  }
  return raw.trim();
}

/**
 * Look for music attribution spans in the viewport (i.e., for the current reel).
 * Instagram renders "Artist · Song" inside span[dir="auto"] elements.
 * We capture instead of filtering so that DeepSeek gets audio context.
 *
 * IMPORTANT: We only look in-viewport and do NOT fall back to off-screen spans.
 * Off-screen spans belong to previously-viewed reels still in the DOM, and using
 * them causes the same song to be attached to every subsequent reel.
 */
function extractMusicFromDOM(): string {
  const allSpans = Array.from(
    document.querySelectorAll<HTMLElement>("span[dir='auto']")
  );

  // Only consider spans visible in the viewport — those belong to the active reel.
  // If none are visible, return "" rather than falling back to stale DOM spans.
  const inViewport = allSpans.filter(
    (el) => isMusicAttribution(el.textContent?.trim() ?? "") && isInViewport(el)
  );

  if (inViewport.length === 0) return "";

  const text = inViewport[0].textContent?.trim() ?? "";
  return text ? formatMusicInfo(text) : "";
}

// ─── Comment extraction ───────────────────────────────────────────────────────

/**
 * Best-effort extraction of comment text from the Instagram DOM.
 *
 * Instagram renders comments in list items (ul > li > span[dir="auto"]).
 * The caption is typically NOT inside a <ul>, so this selector filters it out.
 * Result quality varies — falls back to empty array if nothing useful is found.
 */
function extractCommentsFromDOM(captionText: string): string[] {
  const comments: string[] = [];
  const seen = new Set<string>();

  // Comments live inside list items; the caption does not.
  const commentSpans = Array.from(
    document.querySelectorAll<HTMLElement>("ul span[dir='auto'], li span[dir='auto']")
  );

  for (const el of commentSpans) {
    const text = el.textContent?.trim() ?? "";

    // Basic quality gates
    if (text.length < 10 || text.length > 400) continue;
    if (isJunk(text)) continue;
    if (seen.has(text)) continue;

    // Skip if it's the caption we already extracted
    if (captionText && text.startsWith(captionText.slice(0, 40))) continue;

    seen.add(text);
    comments.push(text);
    if (comments.length >= 5) break;
  }

  return comments;
}

// ─── Caption quality score ────────────────────────────────────────────────────

function captionScore(text: string): number {
  let score = text.length;
  // Hashtags are a strong signal it's a real caption
  const hashtags = (text.match(/#\w/g) ?? []).length;
  score += hashtags * 15;
  // Emoji too
  if (/\p{Emoji}/u.test(text)) score += 10;
  // Natural language (spaces) preferred over packed text
  const words = text.trim().split(/\s+/).length;
  if (words > 3) score += 5;
  return score;
}

// ─── Viewport visibility ──────────────────────────────────────────────────────

function isInViewport(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.top < window.innerHeight &&
    rect.bottom > 0
  );
}

// ─── DOM extraction ───────────────────────────────────────────────────────────

function extractFromDOM(): string {
  // All span[dir="auto"] — confirmed via live DOM inspection to contain
  // captions, usernames, music attributions, locations, counts, UI labels.
  const allSpans = Array.from(
    document.querySelectorAll<HTMLElement>("span[dir='auto']")
  );

  const captionCandidates = allSpans.filter((el) => {
    const text = el.textContent?.trim() ?? "";
    return !isJunk(text);
  });

  if (captionCandidates.length === 0) return "";

  // PRIORITY: captions visible in the viewport = current reel's caption
  const inViewport = captionCandidates.filter(isInViewport);
  const pool = inViewport.length > 0 ? inViewport : captionCandidates;

  // Score and pick best
  const scored = pool
    .map((el) => ({ text: el.textContent?.trim() ?? "", el }))
    .sort((a, b) => captionScore(b.text) - captionScore(a.text));

  return scored[0]?.text.slice(0, MAX_TEXT_CHARS) ?? "";
}

// ─── document.title extraction ────────────────────────────────────────────────

const GENERIC_IG_TITLES = new Set([
  "instagram", "reels", "explore", "home", "messages", "notifications",
]);

function isGenericTitle(text: string): boolean {
  const stripped = text.replace(/^\(\d+\)\s*/, "").trim().toLowerCase();
  return GENERIC_IG_TITLES.has(stripped) || stripped === "";
}

/**
 * On /reel/ID/ pages Instagram sets document.title to the caption.
 * Format: 'username on Instagram: "caption text"'
 */
function extractFromTitle(): string {
  const raw = document.title;
  if (!raw || isGenericTitle(raw)) return "";

  let title = raw
    .replace(/^\(\d+\)\s*/, "")                 // strip "(2) " notification badge
    .replace(/\s*[•·|]\s*Instagram\b.*/i, "")   // strip "• Instagram" suffix
    .replace(/\s*on Instagram\s*$/i, "")         // strip "on Instagram"
    .replace(/\s*[-]\s*Instagram\s*$/i, "")      // strip "- Instagram"
    .trim();

  if (isGenericTitle(title)) return "";

  // Strip "username: " or 'username: "' prefix (Instagram title format)
  title = title.replace(/^[^:""\n]{1,50}:\s*[""]?/, "").replace(/[""]$/, "").trim();

  if (isJunk(title)) return "";
  return title.slice(0, MAX_TEXT_CHARS);
}

// ─── OG-tag fetch (primary, most reliable) ────────────────────────────────────

/**
 * Fetch the reel's own page (same-origin, user's cookies included) and
 * extract the caption from the server-rendered `og:description` meta tag.
 *
 * Instagram always sets og:description for public reels — it's used for
 * link previews and SEO. Format:
 *   "1,234 Likes, 56 Comments - username on Instagram: "caption text""
 *
 * This is the most reliable signal: no CSS-class fragility, no timing race.
 */
async function fetchOgCaption(reelId: string): Promise<string> {
  if (!reelId) return "";
  try {
    const resp = await fetch(`/reels/${reelId}/`, {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    if (!resp.ok) return "";
    const html = await resp.text();

    // Grab og:description value
    const ogMatch = html.match(
      /<meta\s+property="og:description"\s+content="([^"]+)"/i
    ) ?? html.match(
      /<meta\s+content="([^"]+)"\s+property="og:description"/i
    );
    if (!ogMatch) return "";

    let desc = ogMatch[1];

    // Decode ALL HTML entities — named + numeric decimal + numeric hex
    // e.g. &#x92b; → फ  &#39; → '  &amp; → &
    // Using a textarea element is the simplest complete solution.
    try {
      const el = document.createElement("textarea");
      el.innerHTML = desc;
      desc = el.value;
    } catch {
      // Fallback: manual decode of common entities
      desc = desc
        .replace(/&#x([0-9a-fA-F]+);/gi, (_, h) =>
          String.fromCodePoint(parseInt(h, 16))
        )
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
    }

    desc = desc.trim();

    // Strip Instagram's prefix: "16K likes, 17 comments - username on October 4, 2026: "caption""
    // The format varies — strip everything up to and including the first colon + optional quote.
    desc = desc
      .replace(/^[^:]+:\s*[""\u201C\u201D]?/, "")
      .replace(/[""\u201C\u201D]$/, "")
      .trim();

    if (isJunk(desc)) return "";
    return desc.slice(0, MAX_TEXT_CHARS);
  } catch {
    return "";
  }
}

// ─── Main extraction ──────────────────────────────────────────────────────────

export async function extractInstagramReelsContent(): Promise<ExtractionResult> {
  const observedAt = Date.now();

  if (!isInstagramReels()) {
    return {
      supported: false, contentAvailable: false,
      text: "", sourceType: "unknown", fingerprint: "", observedAt,
    };
  }

  const reelId = getCurrentReelId();
  const fingerprint = computeFingerprint(reelId, "");

  // Strategy 1: og:description fetch — reliable, server-rendered, exact caption
  let text = await fetchOgCaption(reelId);
  let source = text ? "og:description" : "";

  // Strategy 2: DOM span[dir="auto"] with viewport filter
  if (!text) {
    text = extractFromDOM();
    if (text) source = "dom";
  }

  // Strategy 3: document.title (works on /reel/ID/ direct pages)
  if (!text) {
    text = extractFromTitle();
    if (text) source = "title";
  }

  if (!text) {
    console.log(`[ABR-IG] No caption | reelId=${reelId}`);
    return {
      supported: true, contentAvailable: false,
      text: "", sourceType: "instagram_reels",
      fingerprint: computeFingerprint(reelId, ""), observedAt,
    };
  }

  const fp = computeFingerprint(reelId, text);

  // Extract music and comments now that the caption is confirmed present
  const musicInfo = extractMusicFromDOM() || undefined;
  const topComments = extractCommentsFromDOM(text);

  console.log(`[ABR-IG] [${source}] "${text.slice(0, 100)}" | reelId=${reelId}`);
  if (musicInfo) console.log(`[ABR-IG] 🎵 Music: ${musicInfo}`);
  if (topComments.length) console.log(`[ABR-IG] 💬 Comments (${topComments.length}): ${topComments[0]?.slice(0, 60)}`);

  return {
    supported: true, contentAvailable: true,
    text, sourceType: "instagram_reels", fingerprint: fp, observedAt,
    musicInfo,
    topComments: topComments.length > 0 ? topComments : undefined,
  };
}
