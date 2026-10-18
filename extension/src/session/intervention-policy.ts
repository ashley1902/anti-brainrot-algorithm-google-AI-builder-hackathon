/**
 * intervention-policy.ts
 *
 * Deterministic, rate-limited intervention policy.
 *
 * States:
 *   NORMAL       session not started
 *   MONITORING   session active, watching
 *   PROMPTED     intervention shown
 *   COOLDOWN     waiting after dismissal
 *   PAUSED       user paused monitoring
 *
 * Intervention gates (all must pass):
 *   1.  MIN_ITEMS_REQUIRED analyzed items
 *   2. Session duration  minimumSessionMs
 *   3. Recent content impact average  threshold
 *   4. Trajectory is "increasing" OR negativeExposureRatio is high
 *   5. Not in COOLDOWN or PAUSED
 *   6. promptsThisSession < maxPromptsPerSession
 */

import type { InterventionState, TrajectoryState } from "../types";

/** Minimum analyzed items before intervention can fire. */
export const MIN_ITEMS_REQUIRED = 5;

/** Per-sensitivity thresholds for recentContentImpact.
 *  Tuned for title-only extraction where scores typically land 0.150.45.
 *  Adjust during testing based on observed false-positive rates.
 */
export const SENSITIVITY_THRESHOLDS: Record<string, number> = {
  low: 0.45,
  medium: 0.30,
  high: 0.20,
};

/** Negative-exposure ratio that alone (with other gates) can trigger. */
export const HIGH_EXPOSURE_RATIO = 0.5;

export interface InterventionContext {
  state: InterventionState;
  analyzedItemCount: number;
  sessionDurationMs: number;
  minimumSessionMs: number;
  recentContentImpact: number;
  negativeExposureRatio: number;
  trajectoryState: TrajectoryState;
  sensitivity: string;
  promptsThisSession: number;
  maxPromptsPerSession: number;
  cooldownEndsAt?: number;
  nowMs: number;
}

export interface PolicyResult {
  shouldPrompt: boolean;
  nextState: InterventionState;
  cooldownEndsAt?: number;
}

/**
 * Pure function: given the current context, decide next state and whether
 * to show an intervention.
 */
export function evaluatePolicy(ctx: InterventionContext): PolicyResult {
  const {
    state,
    analyzedItemCount,
    sessionDurationMs,
    minimumSessionMs,
    recentContentImpact,
    negativeExposureRatio,
    trajectoryState,
    sensitivity,
    promptsThisSession,
    maxPromptsPerSession,
    cooldownEndsAt,
    nowMs,
  } = ctx;

  // Paused  stay paused
  if (state === "PAUSED") {
    return { shouldPrompt: false, nextState: "PAUSED" };
  }

  // Cooldown not yet expired  stay in COOLDOWN
  if (state === "COOLDOWN") {
    if (cooldownEndsAt !== undefined && nowMs < cooldownEndsAt) {
      return { shouldPrompt: false, nextState: "COOLDOWN", cooldownEndsAt };
    }
    // Cooldown expired  back to MONITORING
    return { shouldPrompt: false, nextState: "MONITORING" };
  }

  // NORMAL  MONITORING when session begins
  if (state === "NORMAL") {
    return { shouldPrompt: false, nextState: "MONITORING" };
  }

  // PROMPTED  shouldn't re-evaluate until user responds; stay as is
  if (state === "PROMPTED") {
    return { shouldPrompt: false, nextState: "PROMPTED" };
  }

  // === MONITORING: evaluate all gates ===

  // Gate 1: enough data
  if (analyzedItemCount < MIN_ITEMS_REQUIRED) {
    return { shouldPrompt: false, nextState: "MONITORING" };
  }

  // Gate 2: minimum session duration
  if (sessionDurationMs < minimumSessionMs) {
    return { shouldPrompt: false, nextState: "MONITORING" };
  }

  // Gate 3: prompt budget
  if (promptsThisSession >= maxPromptsPerSession) {
    return { shouldPrompt: false, nextState: "MONITORING" };
  }

  // Gate 4: recent impact above threshold
  const threshold = SENSITIVITY_THRESHOLDS[sensitivity] ?? SENSITIVITY_THRESHOLDS.medium;
  const impactHigh = recentContentImpact >= threshold;

  // Gate 5: trajectory or repeated-exposure condition
  const trajectoryRising = trajectoryState === "increasing";
  const exposureHigh = negativeExposureRatio >= HIGH_EXPOSURE_RATIO;

  const patternMet = trajectoryRising || exposureHigh;

  if (impactHigh && patternMet) {
    return { shouldPrompt: true, nextState: "PROMPTED" };
  }

  return { shouldPrompt: false, nextState: "MONITORING" };
}

/**
 * Compute the timestamp when cooldown ends.
 */
export function computeCooldownEnd(
  nowMs: number,
  cooldownMinutes: number
): number {
  return nowMs + cooldownMinutes * 60 * 1000;
}
