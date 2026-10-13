// While a rollout runs, the server reports steps such as "2/3 pods ready".
// The page reads the two numbers to draw one square per pod.

export interface PodProgress {
  ready: number;
  total: number;
}

const POD_COUNTS = /^(\d+)\/(\d+) /;

/** Returns the counts at the start of a progress step, or null when the step is some other text. */
export function parsePodProgress(step: string): PodProgress | null {
  const counts = POD_COUNTS.exec(step);
  if (counts === null) {
    return null;
  }
  return { ready: Number(counts[1]), total: Number(counts[2]) };
}
