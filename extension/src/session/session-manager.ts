/**
 * session-manager.ts
 *
 * Maintains in-memory session state for the active tab.
 * Raw extracted text is NEVER stored here.
 *
 * Rolling window: last WINDOW_SIZE analyzed items.
 */

import type {
  ContentFeatures,
  InterventionState,
  SessionItem,
  SessionSnapshot,
  Settings,
  TrajectoryState,
} from "../types";
import {
  computeContentImpact,
  computeNegativeExposureRatio,
} from "./scoring";
import {
  classifyTrajectory,
  computeSlope,
  mean,
} from "./trajectory";
import {
  computeCooldownEnd,
  evaluatePolicy,
} from "./intervention-policy";

/** Max items kept in the rolling window. */
export const WINDOW_SIZE = 10;

export class SessionManager {
  private items: SessionItem[] = [];
  private sessionStartMs: number = Date.now();
  private observedItemCount: number = 0; // items seen (including unanalyzed)
  private totalAnalyzedCount: number = 0; // total API hits (never capped)
  private interventionState: InterventionState = "MONITORING";
  private promptsThisSession: number = 0;
  private cooldownEndsAt: number | undefined = undefined;
  private settings: Settings;

  constructor(settings: Settings) {
    this.settings = settings;
  }

  updateSettings(settings: Settings): void {
    this.settings = settings;
  }

  /** Call when a new content item was observed (even if not analyzed). */
  recordObservedItem(): void {
    this.observedItemCount++;
  }

  /**
   * Record a successfully analyzed item.
   * Raw text must NOT be passed here.
   */
  addAnalyzedItem(
    features: ContentFeatures,
    fingerprint: string
  ): void {
    const contentImpact = computeContentImpact(features);
    const item: SessionItem = {
      observedAt: Date.now(),
      contentImpact,
      sentiment: features.sentiment,
      emotionalIntensity: features.emotionalIntensity,
      topicTags: features.topicTags,
      fingerprint,
    };

    this.totalAnalyzedCount++;
    this.items.push(item);
    if (this.items.length > WINDOW_SIZE) {
      this.items.shift();
    }
  }

  /** Call when user triggers "take_break" or "not_now". */
  recordInterventionResponse(action: "take_break" | "not_now"): void {
    void action; // logged externally if needed
    const cooldownMinutes = this.settings.cooldownMinutes;
    this.cooldownEndsAt = computeCooldownEnd(Date.now(), cooldownMinutes);
    this.interventionState = "COOLDOWN";
  }

  /** Pause monitoring. */
  pause(): void {
    this.interventionState = "PAUSED";
  }

  /** Resume monitoring. */
  resume(): void {
    this.interventionState = "MONITORING";
  }

  /** Reset session entirely. */
  reset(): void {
    this.items = [];
    this.sessionStartMs = Date.now();
    this.observedItemCount = 0;
    this.totalAnalyzedCount = 0;
    this.interventionState = "MONITORING";
    this.promptsThisSession = 0;
    this.cooldownEndsAt = undefined;
  }

  /**
   * Evaluate whether an intervention should be shown.
   * Returns true if the policy fires and updates internal state.
   */
  evaluateIntervention(): boolean {
    const snapshot = this.getSnapshot();
    const result = evaluatePolicy({
      state: this.interventionState,
      analyzedItemCount: snapshot.analyzedItemCount,
      sessionDurationMs: snapshot.sessionDurationMs,
      minimumSessionMs: this.settings.minimumSessionMinutes * 60 * 1000,
      recentContentImpact: snapshot.recentContentImpact,
      negativeExposureRatio: snapshot.negativeExposureRatio,
      trajectoryState: snapshot.trajectoryState,
      sensitivity: this.settings.sensitivity,
      promptsThisSession: this.promptsThisSession,
      maxPromptsPerSession: this.settings.maxPromptsPerSession,
      cooldownEndsAt: this.cooldownEndsAt,
      nowMs: Date.now(),
    });

    this.interventionState = result.nextState;
    if (result.cooldownEndsAt !== undefined) {
      this.cooldownEndsAt = result.cooldownEndsAt;
    }

    if (result.shouldPrompt) {
      this.promptsThisSession++;
    }

    return result.shouldPrompt;
  }

  /** Build a snapshot for the popup. */
  getSnapshot(): SessionSnapshot {
    const now = Date.now();
    const sessionDurationMs = now - this.sessionStartMs;
    const impacts = this.items.map((i) => i.contentImpact);
    const recentImpacts = impacts.slice(-5);

    const meanContentImpact = mean(impacts);
    const recentContentImpact = mean(recentImpacts);
    const negativeExposureRatio = computeNegativeExposureRatio(impacts);
    const trajectorySlope = computeSlope(impacts);
    const trajectoryState: TrajectoryState = classifyTrajectory(impacts);

    // Repeated topic ratio: fraction of items whose first topic was already seen
    const repeatedTopicRatio = this.computeRepeatedTopicRatio();

    // Doomscroll heuristic: 01 composite rule-based score
    const doomscrollHeuristic = this.computeDoomscrollHeuristic(
      sessionDurationMs,
      recentContentImpact,
      negativeExposureRatio,
      trajectoryState
    );

    const dataCoverage =
      this.observedItemCount === 0
        ? 0
        : this.totalAnalyzedCount / this.observedItemCount;

    return {
      sessionDurationMs,
      analyzedItemCount: this.totalAnalyzedCount,
      meanContentImpact,
      recentContentImpact,
      negativeExposureRatio,
      trajectorySlope,
      trajectoryState,
      repeatedTopicRatio,
      doomscrollHeuristic,
      dataCoverage,
      interventionState: this.interventionState,
      promptsThisSession: this.promptsThisSession,
      cooldownEndsAt: this.cooldownEndsAt,
    };
  }

  private computeRepeatedTopicRatio(): number {
    if (this.items.length === 0) return 0;
    const seen = new Set<string>();
    let repeated = 0;
    for (const item of this.items) {
      const primaryTopic = item.topicTags[0];
      if (primaryTopic) {
        if (seen.has(primaryTopic)) repeated++;
        else seen.add(primaryTopic);
      }
    }
    return repeated / this.items.length;
  }

  private computeDoomscrollHeuristic(
    sessionDurationMs: number,
    recentContentImpact: number,
    negativeExposureRatio: number,
    trajectoryState: TrajectoryState
  ): number {
    if (this.items.length === 0) return 0;

    const minSessionMs = this.settings.minimumSessionMinutes * 60 * 1000;
    const durationScore = Math.min(sessionDurationMs / (minSessionMs * 3), 1);
    const impactScore = recentContentImpact;
    const exposureScore = negativeExposureRatio;
    const trendScore = trajectoryState === "increasing" ? 1 : 0;

    // Simple weighted average; not a calibrated probability
    return (
      0.3 * durationScore +
      0.3 * impactScore +
      0.25 * exposureScore +
      0.15 * trendScore
    );
  }
}
