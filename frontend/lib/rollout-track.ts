import { ROLLOUT_ONLY } from "@/lib/constants.ts";
import type { OperationStage, PodProgress, RolloutState, TrackPart } from "@/lib/types.ts";

// The rollout track runs from 0, where the change was sent, to 1, where the rollout has finished.
// The pods stand between the two ends, evenly spaced.
// A change that builds an image has more stages than the pods. Each stage then has its own part
// of the track, and the pods stand in theirs.

/** The pods' part of the track when a change has no other stages. */
const WHOLE_TRACK: TrackPart = { stage: "pods", start: 0, end: 1 };

/** Gives every stage its part of the track, in order. Without stages the pods have the whole track. */
export function trackParts(stages: OperationStage[] = ROLLOUT_ONLY): TrackPart[] {
  // The pods get as much room as the other stages together, because there can be many pods.
  const others = stages.filter((stage) => stage !== "pods").length;
  const sizeOf = (stage: OperationStage) => (stage === "pods" ? Math.max(others, 1) : 1);
  const whole = stages.reduce((sum, stage) => sum + sizeOf(stage), 0);

  let covered = 0;
  return stages.map((stage) => {
    const start = covered / whole;
    covered += sizeOf(stage);
    return { stage, start, end: covered / whole };
  });
}

/** A point in a part of the track: 0 is where the part starts and 1 is where it ends. */
function pointIn(part: TrackPart, fraction: number): number {
  return part.start + fraction * (part.end - part.start);
}

/** Where on the track the square of a pod stands. The first pod has index 0. `part` is the pods' part of the track. */
export function podPosition(index: number, total: number, part: TrackPart = WHOLE_TRACK): number {
  return pointIn(part, (index + 1) / (total + 1));
}

/** Where on the track Rollo is: halfway to the pod that is starting now, and at the end only after a success. */
export function runnerPosition(
  state: RolloutState,
  pods: PodProgress | null,
  stages?: OperationStage[],
  stage?: OperationStage,
): number {
  if (state === "succeeded") {
    return 1;
  }
  // Without stages there is only the rollout, and the change is at the pods.
  const current = stages === undefined ? "pods" : stage;
  const part = trackParts(stages).find((each) => each.stage === current);
  if (part === undefined) {
    return 0;
  }
  // A stage before the pods has nothing to count, so Rollo stays in the middle of its part.
  if (part.stage !== "pods") {
    return pointIn(part, 0.5);
  }
  if (pods === null) {
    return part.start;
  }
  // While old pods are still running, a cluster can report more ready pods than were asked for.
  const ready = Math.min(pods.ready, pods.total);
  return pointIn(part, (ready + 0.5) / (pods.total + 1));
}
