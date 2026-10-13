import type { HealthStatus } from "@/types/monitoring.ts";

export const IMAGE_PROBLEMS = new Set(["ImagePullBackOff", "ErrImagePull", "InvalidImageName"]);

/** Waiting reasons a new pod passes through on its way up. They are not problems. */
export const NORMAL_STARTUP = new Set(["ContainerCreating", "PodInitializing"]);

export const LOG_LINES_TO_READ = 5;

export const STATUS_SEVERITY: Record<HealthStatus, number> = { HEALTHY: 0, DEGRADED: 1, DOWN: 2 };

export const MAX_EXPLAINED_PODS = 5;

export const KIBIBYTE = 1024;

export const MEBIBYTE = 1024 * KIBIBYTE;

export const GIBIBYTE = 1024 * MEBIBYTE;

export const TEBIBYTE = 1024 * GIBIBYTE;

// A number such as "250", "0.5" or "129e6", followed by an optional suffix.
export const QUANTITY_PATTERN = /^(\d+(?:\.\d+)?(?:[eE]\d+)?)([a-zA-Z]*)$/;

export const MEMORY_SUFFIX_BYTES: Record<string, number> = {
  "": 1,
  m: 1 / 1000,
  k: 1000,
  M: 1000 ** 2,
  G: 1000 ** 3,
  T: 1000 ** 4,
  Ki: KIBIBYTE,
  Mi: MEBIBYTE,
  Gi: GIBIBYTE,
  Ti: TEBIBYTE,
};
