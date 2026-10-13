import type { LlmSettings, Thresholds } from "@/types/config.ts";

export const THRESHOLD_KEYS: (keyof Thresholds)[] = [
  "memoryPercentOfLimit",
  "cpuPercentOfLimit",
  "restartCount",
  "oomKillWindowMinutes",
  "healthResponseMs",
  "pendingSeconds",
];

export const LLM_DEFAULTS: LlmSettings = { model: "gpt-4.1-mini", requestTimeoutMs: 8000, retryAfterSeconds: 60 };
