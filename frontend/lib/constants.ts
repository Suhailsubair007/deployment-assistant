import type { RolloutState, StepState } from "@/lib/types.ts";

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

/** How often the page asks for the progress of a running change. */
export const PROGRESS_POLL_MS = 1000;

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
