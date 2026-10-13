import type { RolloMood, RolloutState, SplashStage, StepState } from "@/lib/types.ts";

/** The robot that speaks for the assistant. The name is short for "rollout". */
export const ASSISTANT_NAME = "Rollo";

export const POD_COUNTS = /^(\d+)\/(\d+) /;

// The brackets make split() keep the matched word; \b stops a match inside "SHUTDOWN".
export const STATUS_WORDS = /\b(HEALTHY|DEGRADED|DOWN)\b/;

// Everything that can go wrong after Confirm goes wrong while the pods start.
export const PODS_STEP_STATE: Record<RolloutState, StepState> = {
  running: "active",
  succeeded: "done",
  failed: "failed",
  unknown: "pending",
};

/** How Rollo looks while it follows a change: busy until the end, then pleased or uneasy. */
export const MOOD_OF_ROLLOUT: Record<RolloutState, RolloMood> = {
  running: "working",
  succeeded: "happy",
  failed: "worried",
  unknown: "idle",
};

/** How often the page asks for the progress of a running change. */
export const PROGRESS_POLL_MS = 1000;

/** How long the splash screen takes to fade out. */
export const SPLASH_FADE_MS = 450;

/** What the splash screen does after its spinner, and how long after the page opened, in milliseconds. */
export const SPLASH_STAGES: { stage: SplashStage; afterMs: number }[] = [
  { stage: "ready", afterMs: 1500 }, // the spinner becomes a tick and Rollo smiles
  { stage: "leaving", afterMs: 2300 }, // the screen fades out
  { stage: "gone", afterMs: 2300 + SPLASH_FADE_MS }, // it is taken off the page
];

export const SESSION_HEADER = "X-Session-Id";
export const USER_HEADER = "X-User-Name";

export const SESSION_ID_KEY = "sessionId";
export const USER_NAME_KEY = "userName";

export const API = {
  chat: "/api/chat",
  actions: "/api/actions",
  operations: "/api/operations",
  status: "/api/status",
  session: "/api/session",
};
