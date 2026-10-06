/**
 * scoring.test.ts
 *
 * Unit tests for the content-impact scoring module.
 * These tests are deterministic and do NOT call any API.
 */

import { describe, it, expect } from "vitest";
import {
  computeContentImpact,
  computeNegativeExposureRatio,
  clamp,
  clamp01,
  NEGATIVE_EXPOSURE_THRESHOLD,
} from "../src/session/scoring";
import type { ContentFeatures } from "../src/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeFeatures(overrides: Partial<ContentFeatures> = {}): ContentFeatures {
  return {
    topicTags: [],
    sentiment: 0,
    emotionalIntensity: 0,
    anxietyRelated: 0,
    sadness: 0,
    anger: 0,
    fear: 0,
    socialComparison: 0,
    relationshipDistress: 0,
    careerAnxiety: 0,
    financialAnxiety: 0,
    bodyImagePressure: 0,
    fomo: 0,
    rageBait: 0,
    toxicity: 0,
    humor: 0,
    educational: 0,
    inspirational: 0,
    confidence: 1,
    insufficientContext: false,
    ...overrides,
  };
}

// ─── clamp ────────────────────────────────────────────────────────────────────
describe("clamp", () => {
  it("clamps below minimum", () => expect(clamp(-5, 0, 1)).toBe(0));
  it("clamps above maximum", () => expect(clamp(5, 0, 1)).toBe(1));
  it("returns value within range", () => expect(clamp(0.5, 0, 1)).toBe(0.5));
  it("handles exact boundary values", () => {
    expect(clamp(0, 0, 1)).toBe(0);
    expect(clamp(1, 0, 1)).toBe(1);
  });
});

describe("clamp01", () => {
  it("clamps NaN to 0", () => expect(clamp01(NaN)).toBe(0));
  it("clamps non-number to 0", () => expect(clamp01("bad" as unknown as number)).toBe(0));
  it("clamps -1 to 0", () => expect(clamp01(-1)).toBe(0));
  it("clamps 2 to 1", () => expect(clamp01(2)).toBe(1));
  it("passes 0.5 through", () => expect(clamp01(0.5)).toBe(0.5));
});

// ─── computeContentImpact ─────────────────────────────────────────────────────
describe("computeContentImpact", () => {
  it("returns 0 for all-zero neutral features", () => {
    // sentiment=0 → negativeSentiment=0.5, rest=0
    // impact = 0.25*0 + 0.20*0.5 + rest=0 = 0.10
    const features = makeFeatures({ sentiment: 0 });
    const impact = computeContentImpact(features);
    expect(impact).toBeCloseTo(0.1, 5);
  });

  it("returns higher value for very negative sentiment", () => {
    const features = makeFeatures({ sentiment: -1, emotionalIntensity: 1 });
    const impact = computeContentImpact(features);
    // emotionalIntensity contributes 0.25, negativeSentiment=1 contributes 0.20
    expect(impact).toBeGreaterThan(0.4);
  });

  it("returns lower value for positive uplifting content", () => {
    const features = makeFeatures({
      sentiment: 0.9,
      emotionalIntensity: 0.1,
      inspirational: 1,
      humor: 1,
    });
    const impact = computeContentImpact(features);
    expect(impact).toBeLessThan(0.2);
  });

  it("correctly weights rage-bait and anxiety", () => {
    const features = makeFeatures({
      rageBait: 1,
      anxietyRelated: 1,
      sentiment: 0, // neutral baseline
    });
    const impact = computeContentImpact(features);
    // rageBait=0.10, anxietyRelated=0.15, negativeSentiment=0.20*0.5=0.10
    // total = 0 + 0.10 + 0.15 + 0 + 0.10 + 0 + 0 + 0 = 0.35
    expect(impact).toBeCloseTo(0.35, 5);
  });

  it("clamps output to [0, 1] even with extreme inputs", () => {
    const features = makeFeatures({
      sentiment: -1,
      emotionalIntensity: 1,
      anxietyRelated: 1,
      socialComparison: 1,
      rageBait: 1,
      relationshipDistress: 1,
      fomo: 1,
      financialAnxiety: 1,
    });
    const impact = computeContentImpact(features);
    expect(impact).toBeLessThanOrEqual(1);
    expect(impact).toBeGreaterThanOrEqual(0);
  });

  it("handles invalid/undefined numeric fields gracefully", () => {
    const features = makeFeatures({
      emotionalIntensity: undefined as unknown as number,
      rageBait: "oops" as unknown as number,
    });
    expect(() => computeContentImpact(features)).not.toThrow();
    const impact = computeContentImpact(features);
    expect(impact).toBeGreaterThanOrEqual(0);
    expect(impact).toBeLessThanOrEqual(1);
  });
});

// ─── computeNegativeExposureRatio ─────────────────────────────────────────────
describe("computeNegativeExposureRatio", () => {
  it("returns 0 for empty array", () => {
    expect(computeNegativeExposureRatio([])).toBe(0);
  });

  it("returns 0 when all below threshold", () => {
    expect(computeNegativeExposureRatio([0.1, 0.2, 0.3])).toBe(0);
  });

  it("returns 1 when all above threshold", () => {
    const high = [NEGATIVE_EXPOSURE_THRESHOLD, 0.7, 0.9];
    expect(computeNegativeExposureRatio(high)).toBe(1);
  });

  it("returns correct ratio for mixed array", () => {
    const impacts = [0.2, 0.3, 0.6, 0.8]; // 2 of 4 above threshold
    expect(computeNegativeExposureRatio(impacts)).toBe(0.5);
  });
});
