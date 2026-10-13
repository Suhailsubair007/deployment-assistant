import type { FailureExplainer } from "@/services/failureExplainer.ts";
import type { HistoryStore } from "@/services/historyStore.ts";
import type { MetricsService } from "@/services/metricsService.ts";
import type { ClusterGateway, DeploymentInfo, HealthProbe, PodInfo } from "@/types/cluster.ts";
import type { AppConfig } from "@/types/config.ts";

export type HealthStatus = "HEALTHY" | "DEGRADED" | "DOWN";

/** A pod that is not working properly, with the reason in plain words. */
export interface PodProblem {
  podName: string;
  explanation: string;
}

export interface HealthInput {
  app: string;
  deployment: DeploymentInfo;
  probe: HealthProbe;
  usage: AppUsage | MetricsUnavailable;
  podProblems: PodProblem[];
}

export interface HealthReport {
  status: HealthStatus;
  /** Why the status is not HEALTHY. Empty when it is. */
  reasons: string[];
  /** What could not be checked, for example because metrics-server is missing. */
  notes: string[];
}

/** One resource of one pod (or of all pods together). CPU is in millicores, memory in bytes. */
export interface ResourceUse {
  used: number;
  /** Null when a container has no request set. */
  request: number | null;
  /** Null when a container has no limit set. */
  limit: number | null;
  percentOfRequest: number | null;
  percentOfLimit: number | null;
}

export interface PodUsageReport {
  podName: string;
  restarts: number;
  /** How the pod's container last ended, for example "OOMKilled". */
  lastTerminationReason?: string;
  cpu: ResourceUse;
  memory: ResourceUse;
}

export interface AppUsage {
  available: true;
  /** Pods that have usage numbers. */
  pods: PodUsageReport[];
  /** Pods metrics-server has no numbers for yet (it needs a minute or two after a pod starts). */
  podsWithoutMetrics: string[];
  /** Sums over `pods`. */
  total: { cpu: ResourceUse; memory: ResourceUse };
}

export interface MetricsUnavailable {
  available: false;
  /** Why there are no numbers, in words for the user. */
  reason: string;
}

export interface NodeReport {
  name: string;
  ready: boolean;
  memoryPressure: boolean;
  diskPressure: boolean;
  /** Usage as a share of what the node can hand out; null when metrics are unavailable. */
  cpuPercent: number | null;
  memoryPercent: number | null;
}

export interface NodesReport {
  nodes: NodeReport[];
  /** Set when the percentages are missing because metrics-server is unavailable. */
  metricsUnavailableReason: string | null;
}

/** Everything known about one app in one environment, with the verdict. */
export interface AppStatus {
  environment: string;
  app: string;
  health: HealthReport;
  deployment: DeploymentInfo;
  pods: PodInfo[];
  probe: HealthProbe;
  usage: AppUsage | MetricsUnavailable;
}

/** One row of the status panel. */
export interface EnvironmentSummary {
  environment: string;
  app: string;
  /** "NOT DEPLOYED" when nothing runs there; "UNKNOWN" when the cluster could not be asked. */
  status: HealthStatus | "NOT DEPLOYED" | "UNKNOWN";
  /** Why the status is what it is. Empty when HEALTHY. */
  reason: string;
  /** Image running now, or null when nothing is deployed or it could not be read. */
  image: string | null;
  /** When this environment was last changed through the assistant, from the history. */
  lastUpdate: Date | null;
}

export interface StatusServiceDeps {
  gateway: ClusterGateway;
  metrics: MetricsService;
  explainer: FailureExplainer;
  history: HistoryStore;
  config: AppConfig;
  /** The current time. Tests replace this. */
  now?: () => Date;
}
