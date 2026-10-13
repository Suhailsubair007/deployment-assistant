// A confirmed change goes through three steps. This file works out how far it is,
// so the page can draw the steps as a list that is ticked off one by one.

import type { PodProgress } from "./pod-progress.ts";

/** "unknown" means the page can no longer ask the server about this change. */
export type RolloutState = "running" | "succeeded" | "failed" | "unknown";

export type StepState = "done" | "active" | "failed" | "pending";

export interface RolloutStep {
  id: "sent" | "pods" | "finished";
  title: string;
  /** A short line under the title, or "" for none. */
  detail: string;
  state: StepState;
}

// Everything that can go wrong after Confirm goes wrong while the pods start.
const PODS_STEP_STATE: Record<RolloutState, StepState> = {
  running: "active",
  succeeded: "done",
  failed: "failed",
  unknown: "pending",
};

/** The three steps of a change and the state of each one. */
export function buildRolloutSteps(state: RolloutState, pods: PodProgress | null): RolloutStep[] {
  let podsDetail = "";
  if (pods !== null) {
    podsDetail = `${pods.ready} of ${pods.total} ready`;
  } else if (state === "running") {
    podsDetail = "Waiting for the first pod";
  }

  return [
    // The server follows a change only after the cluster has accepted it, so this one is always done.
    { id: "sent", title: "Change sent to the cluster", detail: "", state: "done" },
    { id: "pods", title: "Starting the pods", detail: podsDetail, state: PODS_STEP_STATE[state] },
    { id: "finished", title: "Rollout finished", detail: "", state: state === "succeeded" ? "done" : "pending" },
  ];
}
