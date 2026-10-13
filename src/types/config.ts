/** When an app counts as DEGRADED. Every value comes from the config file. */
export interface Thresholds {
  memoryPercentOfLimit: number;
  cpuPercentOfLimit: number;
  restartCount: number;
  oomKillWindowMinutes: number;
  healthResponseMs: number;
  pendingSeconds: number;
}

export interface EnvironmentConfig {
  namespace: string;
  /** Protected environments (prod) show an extra warning before a change. */
  protected: boolean;
}

/** CPU and memory as Kubernetes writes them, for example "100m" and "128Mi". */
export interface ResourceAmounts {
  cpu: string;
  memory: string;
}

export interface AppDefaults {
  imageRepository: string;
  port: number;
  /** Replicas used the first time the app is deployed. */
  replicas: number;
  /** The assistant refuses to scale beyond this. */
  maxReplicas: number;
  resources: { requests: ResourceAmounts; limits: ResourceAmounts };
}

export interface Timeouts {
  rolloutSeconds: number;
  healthRequestMs: number;
  pollIntervalMs: number;
}

/** Settings for reading chat messages with OpenAI. Used only when an API key is set. */
export interface LlmSettings {
  model: string;
  /** Give up on one OpenAI call after this long. */
  requestTimeoutMs: number;
  /** After a failed call, the built-in rules read every message for this long. */
  retryAfterSeconds: number;
}

export interface AppConfig {
  environments: Record<string, EnvironmentConfig>;
  apps: Record<string, AppDefaults>;
  timeouts: Timeouts;
  thresholds: { default: Thresholds; overrides: Record<string, Partial<Thresholds>> };
  llm: LlmSettings;
}

export type Section = Record<string, unknown>;
