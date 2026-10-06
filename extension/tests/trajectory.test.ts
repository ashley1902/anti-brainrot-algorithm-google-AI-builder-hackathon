/**
 * trajectory.test.ts
 *
 * Unit tests for the trajectory analysis module.
 */

import { describe, it, expect } from "vitest";
import {
  classifyTrajectory,
  computeSlope,
  mean,
  MIN_ITEMS_FOR_TREND,
  TRAJECTORY_DEADBAND,
} from "../src/session/trajectory";

// ─── computeSlope ─────────────────────────────────────────────────────────────
describe("computeSlope", () => {
  it("returns 0 for single-element array", () => {
    expect(computeSlope([0.5])).toBe(0);
  });

  it("returns 0 for empty array", () => {
    expect(computeSlope([])).toBe(0);
  });

  it("returns positive slope for increasing sequence", () => {
    const slope = computeSlope([0.1, 0.2, 0.3, 0.4, 0.5]);
    expect(slope).toBeGreaterThan(0);
  });

  it("returns negative slope for decreasing sequence", () => {
    const slope = computeSlope([0.5, 0.4, 0.3, 0.2, 0.1]);
    expect(slope).toBeLessThan(0);
  });

  it("returns ~0 slope for flat sequence", () => {
    const slope = computeSlope([0.5, 0.5, 0.5, 0.5]);
    expect(Math.abs(slope)).toBeLessThan(0.001);
  });

  it("handles a 2-element array", () => {
    const slope = computeSlope([0.2, 0.8]);
    expect(slope).toBeGreaterThan(0);
  });
});

// ─── classifyTrajectory ───────────────────────────────────────────────────────
describe("classifyTrajectory", () => {
  it("returns insufficient_data when fewer than MIN_ITEMS_FOR_TREND items", () => {
    const shortList = Array(MIN_ITEMS_FOR_TREND - 1).fill(0.5);
    expect(classifyTrajectory(shortList)).toBe("insufficient_data");
  });

  it("returns insufficient_data for empty array", () => {
    expect(classifyTrajectory([])).toBe("insufficient_data");
  });

  it("returns 'increasing' for clearly rising values", () => {
    const rising = [0.1, 0.25, 0.4, 0.55, 0.7];
    expect(classifyTrajectory(rising)).toBe("increasing");
  });

  it("returns 'decreasing' for clearly falling values", () => {
    const falling = [0.7, 0.55, 0.4, 0.25, 0.1];
    expect(classifyTrajectory(falling)).toBe("decreasing");
  });

  it("returns 'stable' for flat values", () => {
    const flat = [0.4, 0.41, 0.39, 0.4, 0.41];
    expect(classifyTrajectory(flat)).toBe("stable");
  });

  it("returns 'stable' when slope is within deadband", () => {
    // Tiny positive slope should be within deadband
    const tiny = [0.5, 0.505, 0.51, 0.515, 0.52];
    expect(classifyTrajectory(tiny, TRAJECTORY_DEADBAND)).toBe("stable");
  });

  it("respects custom deadband parameter", () => {
    const rising = [0.1, 0.25, 0.4, 0.55, 0.7];
    // Very large deadband — should all be stable
    expect(classifyTrajectory(rising, 1.0)).toBe("stable");
    // Zero deadband — even tiny changes classified
    expect(classifyTrajectory(rising, 0)).toBe("increasing");
  });

  it("requires exactly MIN_ITEMS_FOR_TREND items to give a trend", () => {
    const exactly = Array(MIN_ITEMS_FOR_TREND).fill(0).map((_, i) => i * 0.1);
    const result = classifyTrajectory(exactly);
    expect(result).not.toBe("insufficient_data");
  });
});

// ─── mean ─────────────────────────────────────────────────────────────────────
describe("mean", () => {
  it("returns 0 for empty array", () => {
    expect(mean([])).toBe(0);
  });

  it("returns the single value for single-element array", () => {
    expect(mean([0.7])).toBe(0.7);
  });

  it("computes correct mean", () => {
    expect(mean([0.2, 0.4, 0.6])).toBeCloseTo(0.4, 10);
  });
});
