import type { OperationStage, RolloMood, RolloutState, SplashStage, StepState } from "@/lib/types.ts";

/** The robot that speaks for the assistant. The name is short for "rollout". */
export const ASSISTANT_NAME = "Rollo";

export const POD_COUNTS = /^(\d+)\/(\d+) /;

// The brackets make split() keep the matched word; \b stops a match inside "SHUTDOWN".
export const STATUS_WORDS = /\b(HEALTHY|DEGRADED|DOWN)\b/;

// The state of the step a change is at. Whatever goes wrong after Confirm goes wrong in that step.
export const CURRENT_STEP_STATE: Record<RolloutState, StepState> = {
  running: "active",
  succeeded: "done",
  failed: "failed",
  unknown: "pending",
};

/** A change without stages only starts pods. */
export const ROLLOUT_ONLY: OperationStage[] = ["pods"];

/** What each stage before the pods is called, and the short line next to that name while the stage runs. */
export const IMAGE_STAGES: Record<Exclude<OperationStage, "pods">, { title: string; hint: string }> = {
  // No hint: on a narrow screen this long name and a hint do not fit on one row.
  repository: { title: "Preparing the image repository", hint: "" },
  build: { title: "Building the image", hint: "This can take a few minutes" },
  publish: { title: "Uploading the image", hint: "This can take a few minutes" },
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

// A build can run for minutes. One request that fails on the way (a short network
// hiccup) must not end the follow, so it gives up only after this many failures in a row.
export const PROGRESS_FAILURES_BEFORE_GIVING_UP = 5;

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
