/**
 * scoring.ts
 *
 * Calculates a "content impact estimate" from raw AI feature scores.
 *
 * IMPORTANT: This is an EXPERIMENTAL heuristic, not a validated clinical metric.
 * Weights are initial assumptions and must be tunable. Do not label this a
 * "mental health score" or present it as a measurement of user state.
 *
 * Formula weights (must sum to 1.0):
 *   emotionalIntensity   0.25
 *   negativeSentiment    0.20
 *   anxietyRelated       0.15
 *   socialComparison     0.10
 *   rageBait             0.10
 *   relationshipDistress 0.10
 *   fomo                 0.05
 *   financialAnxiety     0.05
 */

import type { ContentFeatures } from "../types";

/** Clamp a number to [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Validate a numeric field is in [0,1]; clamp if out of range. */
export function clamp01(value: unknown): number {
  if (typeof value !== "number" || !isFinite(value)) return 0;
  return clamp(value, 0, 1);
}

/**
 * Compute content impact estimate from ContentFeatures.
 * Returns a value in [0, 1].
 *
 * negativeSentiment = clamp((1 - sentiment) / 2, 0, 1)
 *   → converts the [-1, +1] sentiment range so that -1 → 1.0 and +1 → 0.0
 */
export function computeContentImpact(features: ContentFeatures): number {
  const sentiment = clamp(
    typeof features.sentiment === "number" ? features.sentiment : 0,
    -1,
    1
  );
  const negativeSentiment = clamp01((1 - sentiment) / 2);

  const raw =
    0.25 * clamp01(features.emotionalIntensity) +
    0.20 * negativeSentiment +
    0.15 * clamp01(features.anxietyRelated) +
    0.10 * clamp01(features.socialComparison) +
    0.10 * clamp01(features.rageBait) +
    0.10 * clamp01(features.relationshipDistress) +
    0.05 * clamp01(features.fomo) +
    0.05 * clamp01(features.financialAnxiety);

  return clamp01(raw);
}

/** High-impact threshold used for negativeExposureRatio calculation.
 *  Lowered to 0.25 to reflect realistic title-only extraction scores.
 */
export const NEGATIVE_EXPOSURE_THRESHOLD = 0.25;

/**
 * Fraction of items in the window with contentImpact >= NEGATIVE_EXPOSURE_THRESHOLD.
 */
export function computeNegativeExposureRatio(impacts: number[]): number {
  if (impacts.length === 0) return 0;
  const count = impacts.filter((v) => v >= NEGATIVE_EXPOSURE_THRESHOLD).length;
  return count / impacts.length;
}
