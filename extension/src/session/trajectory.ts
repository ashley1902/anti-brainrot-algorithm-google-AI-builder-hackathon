/**
 * trajectory.ts
 *
 * Computes the trend direction of recent content-impact values using a
 * simple linear slope. Requires at least MIN_ITEMS_FOR_TREND data points
 * before emitting "increasing" or "decreasing" states.
 *
 * Changes smaller than DEADBAND are considered "stable".
 */

import type { TrajectoryState } from "../types";

/** Minimum analyzed items before calling a trend. */
export const MIN_ITEMS_FOR_TREND = 4;

/**
 * Slope smaller than this (per item) is treated as stable.
 * Configurable: increase to require a steeper trend before flagging.
 */
export const TRAJECTORY_DEADBAND = 0.02;

/**
 * Compute a simple ordinary least-squares slope over an array of values.
 * Returns the slope (rise per unit x).
 */
export function computeSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (values[i] - meanY);
    den += (i - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/**
 * Classify the trajectory state from a sequence of contentImpact values.
 *
 * @param impacts - Ordered array of recent contentImpact values (oldest first)
 * @param deadband - Minimum slope magnitude to be called increasing/decreasing
 */
export function classifyTrajectory(
  impacts: number[],
  deadband: number = TRAJECTORY_DEADBAND
): TrajectoryState {
  if (impacts.length < MIN_ITEMS_FOR_TREND) return "insufficient_data";
  const slope = computeSlope(impacts);
  if (Math.abs(slope) < deadband) return "stable";
  return slope > 0 ? "increasing" : "decreasing";
}

/**
 * Compute mean of an array. Returns 0 for empty arrays.
 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}
