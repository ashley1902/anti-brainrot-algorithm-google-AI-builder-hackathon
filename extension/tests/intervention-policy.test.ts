/**
 * intervention-policy.test.ts
 *
 * Unit tests for the intervention policy state machine.
 * All tests are deterministic and require no API calls.
 */

import { describe, it, expect } from "vitest";
import {
  evaluatePolicy,
  computeCooldownEnd,
  MIN_ITEMS_REQUIRED,
  SENSITIVITY_THRESHOLDS,
} from "../src/session/intervention-policy";
import type { InterventionContext } from "../src/session/intervention-policy";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeCtx(overrides: Partial<InterventionContext> = {}): InterventionContext {
  return {
    state: "MONITORING",
    analyzedItemCount: 10,
    sessionDurationMs: 10 * 60 * 1000, // 10 minutes
    minimumSessionMs: 5 * 60 * 1000,   // 5 minutes
    recentContentImpact: 0.7,
    negativeExposureRatio: 0.7,
    trajectoryState: "increasing",
    sensitivity: "medium",
    promptsThisSession: 0,
    maxPromptsPerSession: 2,
    cooldownEndsAt: undefined,
    nowMs: Date.now(),
    ...overrides,
  };
}

// ─── Basic state transitions ──────────────────────────────────────────────────
describe("evaluatePolicy state transitions", () => {
  it("NORMAL → MONITORING", () => {
    const result = evaluatePolicy(makeCtx({ state: "NORMAL" }));
    expect(result.nextState).toBe("MONITORING");
    expect(result.shouldPrompt).toBe(false);
  });

  it("PAUSED stays PAUSED", () => {
    const result = evaluatePolicy(makeCtx({ state: "PAUSED" }));
    expect(result.nextState).toBe("PAUSED");
    expect(result.shouldPrompt).toBe(false);
  });

  it("PROMPTED stays PROMPTED without re-triggering", () => {
    const result = evaluatePolicy(makeCtx({ state: "PROMPTED" }));
    expect(result.nextState).toBe("PROMPTED");
    expect(result.shouldPrompt).toBe(false);
  });

  it("COOLDOWN unexpired stays COOLDOWN", () => {
    const now = Date.now();
    const result = evaluatePolicy(
      makeCtx({ state: "COOLDOWN", cooldownEndsAt: now + 60000, nowMs: now })
    );
    expect(result.nextState).toBe("COOLDOWN");
    expect(result.shouldPrompt).toBe(false);
  });

  it("COOLDOWN expired → MONITORING", () => {
    const now = Date.now();
    const result = evaluatePolicy(
      makeCtx({ state: "COOLDOWN", cooldownEndsAt: now - 1, nowMs: now })
    );
    expect(result.nextState).toBe("MONITORING");
    expect(result.shouldPrompt).toBe(false);
  });
});

// ─── Intervention gates ───────────────────────────────────────────────────────
describe("intervention gates", () => {
  it("fires when all gates pass (medium sensitivity)", () => {
    const result = evaluatePolicy(makeCtx());
    expect(result.shouldPrompt).toBe(true);
    expect(result.nextState).toBe("PROMPTED");
  });

  it("does NOT fire when analyzedItemCount below minimum", () => {
    const result = evaluatePolicy(
      makeCtx({ analyzedItemCount: MIN_ITEMS_REQUIRED - 1 })
    );
    expect(result.shouldPrompt).toBe(false);
  });

  it("does NOT fire when session duration below minimum", () => {
    const result = evaluatePolicy(
      makeCtx({ sessionDurationMs: 1 * 60 * 1000 })
    );
    expect(result.shouldPrompt).toBe(false);
  });

  it("does NOT fire when impact below threshold (medium)", () => {
    const threshold = SENSITIVITY_THRESHOLDS.medium;
    const result = evaluatePolicy(
      makeCtx({ recentContentImpact: threshold - 0.1 })
    );
    expect(result.shouldPrompt).toBe(false);
  });

  it("does NOT fire when trajectory is stable and exposure is low", () => {
    const result = evaluatePolicy(
      makeCtx({ trajectoryState: "stable", negativeExposureRatio: 0.2 })
    );
    expect(result.shouldPrompt).toBe(false);
  });

  it("fires with high exposure even when trajectory is not increasing", () => {
    const result = evaluatePolicy(
      makeCtx({ trajectoryState: "stable", negativeExposureRatio: 0.8 })
    );
    expect(result.shouldPrompt).toBe(true);
  });

  it("respects maxPromptsPerSession limit", () => {
    const result = evaluatePolicy(
      makeCtx({ promptsThisSession: 2, maxPromptsPerSession: 2 })
    );
    expect(result.shouldPrompt).toBe(false);
  });

  it("fires with one prompt remaining in budget", () => {
    const result = evaluatePolicy(
      makeCtx({ promptsThisSession: 1, maxPromptsPerSession: 2 })
    );
    expect(result.shouldPrompt).toBe(true);
  });
});

// ─── Sensitivity levels ───────────────────────────────────────────────────────
describe("sensitivity thresholds", () => {
  it("low sensitivity requires higher impact to fire", () => {
    // Just below low threshold
    const threshold = SENSITIVITY_THRESHOLDS.low;
    const below = evaluatePolicy(
      makeCtx({ sensitivity: "low", recentContentImpact: threshold - 0.05 })
    );
    expect(below.shouldPrompt).toBe(false);

    // At or above low threshold
    const above = evaluatePolicy(
      makeCtx({ sensitivity: "low", recentContentImpact: threshold + 0.01 })
    );
    expect(above.shouldPrompt).toBe(true);
  });

  it("high sensitivity fires at lower impact", () => {
    const lowThreshold = SENSITIVITY_THRESHOLDS.high;
    // Impact between high and medium thresholds
    const result = evaluatePolicy(
      makeCtx({
        sensitivity: "high",
        recentContentImpact: lowThreshold + 0.01,
      })
    );
    expect(result.shouldPrompt).toBe(true);
  });
});

// ─── Cooldown computation ─────────────────────────────────────────────────────
describe("computeCooldownEnd", () => {
  it("adds the correct number of milliseconds", () => {
    const now = 1000000;
    const end = computeCooldownEnd(now, 10);
    expect(end).toBe(now + 10 * 60 * 1000);
  });

  it("handles 0 minutes", () => {
    const now = 1000000;
    expect(computeCooldownEnd(now, 0)).toBe(now);
  });
});
