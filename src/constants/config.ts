import type { BuildSettings, LlmSettings, ServiceDefaults, Thresholds } from "@/types/config.ts";

export const THRESHOLD_KEYS: (keyof Thresholds)[] = [
  "memoryPercentOfLimit",
  "cpuPercentOfLimit",
  "restartCount",
  "oomKillWindowMinutes",
  "healthResponseMs",
  "pendingSeconds",
];

export const LLM_DEFAULTS: LlmSettings = { model: "gpt-4.1-mini", requestTimeoutMs: 8000, retryAfterSeconds: 60 };

// The default answers for a new service when the config file has no serviceDefaults section.
export const SERVICE_DEFAULTS: ServiceDefaults = {
  port: 8080,
  healthPath: "/health",
  replicas: 2,
  maxReplicas: 10,
  resources: {
    requests: { cpu: "100m", memory: "128Mi" },
    limits: { cpu: "500m", memory: "256Mi" },
  },
};

// Used when the config file has no build section: build inside the home folder, for 15 minutes at most.
export const BUILD_DEFAULTS: BuildSettings = { allowedRoots: ["~"], timeoutSeconds: 900 };
