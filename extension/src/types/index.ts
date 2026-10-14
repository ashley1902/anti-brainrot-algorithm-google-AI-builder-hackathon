// ─── Content Features ────────────────────────────────────────────────────────
// Returned by the AI provider after analysis.
// All numeric values are ESTIMATES of content characteristics, NOT clinical measurements.

export interface ContentFeatures {
  topicTags: string[];
  /** -1 (very negative) to +1 (very positive) */
  sentiment: number;
  /** 0–1: How emotionally intense the content is */
  emotionalIntensity: number;
  /** 0–1: Anxiety-related themes */
  anxietyRelated: number;
  /** 0–1: Sadness themes */
  sadness: number;
  /** 0–1: Anger themes */
  anger: number;
  /** 0–1: Fear themes */
  fear: number;
  /** 0–1: Social comparison themes */
  socialComparison: number;
  /** 0–1: Relationship distress themes */
  relationshipDistress: number;
  /** 0–1: Career-anxiety themes */
  careerAnxiety: number;
  /** 0–1: Financial anxiety themes */
  financialAnxiety: number;
  /** 0–1: Body-image pressure themes */
  bodyImagePressure: number;
  /** 0–1: Fear of missing out themes */
  fomo: number;
  /** 0–1: Rage-bait / outrage-bait content */
  rageBait: number;
  /** 0–1: Toxic tone */
  toxicity: number;
  /** 0–1: Humorous content */
  humor: number;
  /** 0–1: Educational content */
  educational: number;
  /** 0–1: Inspirational / uplifting content */
  inspirational: number;
  /** 0–1: Envy-inducing content (showing off lifestyle, wealth, beauty) */
  envy: number;
  /** 0–1: Doom / hopelessness / existential despair themes */
  doom: number;
  /** 0–1: Fear-mongering / alarmist content */
  fearMongering: number;
  /** 0–1: Drama, gossip, celebrity scandal content */
  dramaGossip: number;
  /** 0–1: Clickbait — misleading or sensational hook to drive clicks */
  clickbait: number;
  /** 0–1: Cliffhanger — content deliberately left unresolved to compel continued scrolling */
  cliffhanger: number;
  /** 0–1: Validation-seeking — content fishing for likes, sympathy, or approval */
  validationSeeking: number;
  /** 0–1: Nourishing — genuinely wholesome, restorative, or life-affirming content */
  nourishing: number;
  /** 0–1: Model confidence in classification */
  confidence: number;
  /** True when text was too short/ambiguous for reliable classification */
  insufficientContext: boolean;
}

// ─── Session Item ─────────────────────────────────────────────────────────────
// One entry in the rolling window. Raw text is NEVER stored here.

export interface SessionItem {
  observedAt: number; // epoch ms
  contentImpact: number; // 0–1 derived score
  sentiment: number; // -1 to +1
  emotionalIntensity: number; // 0–1
  topicTags: string[];
  watchDurationMs?: number; // only if reliably measurable
  fingerprint: string; // stable hash of content; never the raw text
}

// ─── Session Snapshot ─────────────────────────────────────────────────────────

export type TrajectoryState =
  | "insufficient_data"
  | "stable"
  | "increasing"
  | "decreasing";

export type InterventionState =
  | "NORMAL"
  | "MONITORING"
  | "PROMPTED"
  | "COOLDOWN"
  | "PAUSED";

export interface SessionSnapshot {
  sessionDurationMs: number;
  analyzedItemCount: number;
  meanContentImpact: number;
  recentContentImpact: number;
  negativeExposureRatio: number;
  trajectorySlope: number;
  trajectoryState: TrajectoryState;
  repeatedTopicRatio: number;
  doomscrollHeuristic: number; // 0–1 rule-based estimate
  dataCoverage: number; // fraction of observed items successfully analyzed
  interventionState: InterventionState;
  promptsThisSession: number;
  cooldownEndsAt?: number; // epoch ms
}

// ─── Site Adapter Result ──────────────────────────────────────────────────────

export type SupportedSource = "youtube_shorts" | "instagram_reels";

export interface ExtractionResult {
  supported: boolean;
  contentAvailable: boolean;
  text: string;
  sourceType: SupportedSource | "unknown";
  fingerprint: string;
  observedAt: number;
  /** Audio track being used in the reel/short. Undefined if original audio or not found. */
  musicInfo?: string;
  /** Up to 5 top-liked comments extracted from the reel/short. */
  topComments?: string[];
  /**
   * Direct URL to the audio/video stream for Whisper transcription.
   * Only populated when musicInfo is absent (original audio).
   * Backend downloads this and runs faster-whisper small (CPU, int8).
   */
  audioUrl?: string;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export type Sensitivity = "low" | "medium" | "high";

export interface Settings {
  enabled: boolean;
  supportedSites: {
    youtube: boolean;
  };
  sensitivity: Sensitivity;
  minimumSessionMinutes: number;
  cooldownMinutes: number;
  maxPromptsPerSession: number;
  backendUrl: string;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  supportedSites: { youtube: true },
  sensitivity: "medium",
  minimumSessionMinutes: 5,
  cooldownMinutes: 10,
  maxPromptsPerSession: 2,
  backendUrl: "http://localhost:8787",
};

// ─── Daily Analytics Log ─────────────────────────────────────────────────────
// One entry written to chrome.storage.local after each successful analysis.
// Key: "dailyLog_YYYY-MM-DD". Never contains raw text.

export interface DailyLogEntry {
  timestamp: number;                              // epoch ms
  source: "youtube_shorts" | "instagram_reels";
  impact: number;                                 // computeContentImpact() result
  emotionalIntensity: number;
  rageBait: number;
  sadness: number;
  anxietyRelated: number;
  fomo: number;
  socialComparison: number;
  relationshipDistress: number;
  humor: number;
  inspirational: number;
  envy: number;
  doom: number;
  fearMongering: number;
  dramaGossip: number;
  clickbait: number;
  cliffhanger: number;
  validationSeeking: number;
  nourishing: number;
  topicTags: string[];
}

// ─── Content Analysis Input ───────────────────────────────────────────────────

export interface ContentAnalysisInput {
  text: string;
  source: SupportedSource;
  language?: string;
}

// ─── Extension Messages ───────────────────────────────────────────────────────

export type ExtensionMessage =
  | {
      type: "CONTENT_DETECTED";
      payload: {
        text: string;
        source: SupportedSource;
        fingerprint: string;
        musicInfo?: string;
        topComments?: string[];
        audioUrl?: string;
      };
    }
  | {
      type: "ANALYSIS_RESULT";
      payload: ContentFeatures;
    }
  | {
      type: "SESSION_SNAPSHOT_REQUEST";
    }
  | {
      type: "SESSION_SNAPSHOT";
      payload: SessionSnapshot;
    }
  | {
      type: "SET_MONITORING";
      payload: { enabled: boolean };
    }
  | {
      type: "CLEAR_SESSION";
    }
  | {
      type: "INTERVENTION_RESPONSE";
      payload: { action: "take_break" | "not_now" };
    }
  | {
      type: "SHOW_INTERVENTION";
    }
  | {
      type: "ANALYSIS_ERROR";
      payload: { reason: string };
    };
