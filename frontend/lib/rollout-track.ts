import type { PodProgress, RolloutState } from "@/lib/types.ts";

// The rollout track runs from 0, where the change was sent, to 1, where the rollout has finished.
// The pods stand between the two ends, evenly spaced.

/** Where on the track the square of a pod stands. The first pod has index 0. */
export function podPosition(index: number, total: number): number {
  return (index + 1) / (total + 1);
}

/** Where on the track Rollo is: halfway to the pod that is starting now, and at the end only after a success. */
export function runnerPosition(state: RolloutState, pods: PodProgress | null): number {
  if (state === "succeeded") {
    return 1;
  }
  if (pods === null) {
    return 0;
  }
  // While old pods are still running, a cluster can report more ready pods than were asked for.
  const ready = Math.min(pods.ready, pods.total);
  return (ready + 0.5) / (pods.total + 1);
}
