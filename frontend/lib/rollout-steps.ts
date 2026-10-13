import { PODS_STEP_STATE } from "@/lib/constants.ts";
import type { PodProgress, RolloutState, RolloutStep } from "@/lib/types.ts";

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

/** The step to show as the headline: the one that is in progress or failed, or else the last one that is done. */
export function currentStep(steps: RolloutStep[]): RolloutStep | undefined {
  const unfinished = steps.find((step) => step.state === "active" || step.state === "failed");
  return unfinished ?? steps.findLast((step) => step.state === "done");
}
