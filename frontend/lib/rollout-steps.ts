import { CURRENT_STEP_STATE, IMAGE_STAGES, ROLLOUT_ONLY } from "@/lib/constants.ts";
import type { OperationStage, PodProgress, RolloutState, RolloutStep, StepState } from "@/lib/types.ts";

/** One stage as a step. The pods step counts the ready pods; a stage before it can say that it takes long. */
function stageStep(stage: OperationStage, state: StepState, pods: PodProgress | null): RolloutStep {
  if (stage !== "pods") {
    const { title, hint } = IMAGE_STAGES[stage];
    return { id: stage, title, detail: state === "active" ? hint : "", state };
  }
  let detail = "";
  if (pods !== null) {
    detail = `${pods.ready} of ${pods.total} ready`;
  } else if (state === "active") {
    detail = "Waiting for the first pod";
  }
  return { id: "pods", title: "Starting the pods", detail, state };
}

/**
 * The steps of a change and the state of each one: sent, starting the pods, finished.
 * A change that builds an image has one step per stage where the pods step is.
 */
export function buildRolloutSteps(
  state: RolloutState,
  pods: PodProgress | null,
  stages?: OperationStage[],
  stage?: OperationStage,
): RolloutStep[] {
  // Without stages there is only the rollout: the pods are its one stage, and the change is at it.
  const order = stages ?? ROLLOUT_ONLY;
  const current = stages === undefined ? 0 : stages.findIndex((each) => each === stage);

  function stateOf(index: number): StepState {
    if (state === "succeeded" || index < current) {
      return "done";
    }
    return index === current ? CURRENT_STEP_STATE[state] : "pending";
  }

  return [
    // The server only follows a change that it has started, so this one is always done.
    { id: "sent", title: "Change sent to the cluster", detail: "", state: "done" },
    ...order.map((each, index) => stageStep(each, stateOf(index), pods)),
    { id: "finished", title: "Rollout finished", detail: "", state: state === "succeeded" ? "done" : "pending" },
  ];
}

/** The step to show as the headline: the one that is in progress or failed, or else the last one that is done. */
export function currentStep(steps: RolloutStep[]): RolloutStep | undefined {
  const unfinished = steps.find((step) => step.state === "active" || step.state === "failed");
  return unfinished ?? steps.findLast((step) => step.state === "done");
}
