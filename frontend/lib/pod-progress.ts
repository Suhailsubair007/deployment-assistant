import { POD_COUNTS } from "@/lib/constants.ts";
import type { PodProgress } from "@/lib/types.ts";

/** Returns the counts at the start of a progress step, or null when the step is some other text. */
export function parsePodProgress(step: string): PodProgress | null {
  const counts = POD_COUNTS.exec(step);
  if (counts === null) {
    return null;
  }
  return { ready: Number(counts[1]), total: Number(counts[2]) };
}
