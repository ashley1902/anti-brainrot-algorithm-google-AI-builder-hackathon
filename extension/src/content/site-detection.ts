/**
 * site-detection.ts
 *
 * Determines whether the current page is a supported surface.
 * V0.1: YouTube Shorts
 * V0.2: Instagram Reels (added)
 */

import { isYouTubeShorts } from "./adapters/youtube-shorts";
import { isInstagramReels } from "./adapters/instagram-reels";
import type { SupportedSource } from "../types";

export type PageStatus =
  | { supported: true; source: SupportedSource }
  | { supported: false };

export function detectCurrentPage(): PageStatus {
  if (isYouTubeShorts()) return { supported: true, source: "youtube_shorts" };
  if (isInstagramReels()) return { supported: true, source: "instagram_reels" };
  return { supported: false };
}
