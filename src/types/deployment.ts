import type { FailureExplainer } from "@/services/failureExplainer.ts";
import type { HistoryStore } from "@/services/historyStore.ts";
import type { OperationStore } from "@/services/operationStore.ts";
import type { ClusterGateway } from "@/types/cluster.ts";
import type { AppConfig, AppDefaults, ResourceAmounts } from "@/types/config.ts";

/** A change that has been worked out but not carried out yet. Shown to the user for confirmation. */
export interface ChangePlan {
  action: DeploymentAction;
  environment: string;
  namespace: string;
  app: string;
  /** Image after the change. */
  image: string;
  /** Image running now; null when the app is not deployed yet. */
  currentImage: string | null;
  /** Replicas after the change. */
  replicas: number;
  /** Replicas now; null when the app is not deployed yet. */
  currentReplicas: number | null;
}

export interface StartedOperation {
  /** Progress can be read from this while the rollout runs. */
  operation: Operation;
  /** Settles when the rollout has finished, failed or timed out. It never rejects. */
  done: Promise<void>;
}

export interface DeploymentServiceDeps {
  gateway: ClusterGateway;
  history: HistoryStore;
  operations: OperationStore;
  config: AppConfig;
  explainer: FailureExplainer;
  /** Put in front of image names, for example an ECR registry. Leave empty for local images. */
  imageRegistry?: string;
  /** How to wait between two rollout checks. Tests replace this so they do not really wait. */
  sleep?: (ms: number) => Promise<void>;
  /** The current time in milliseconds. Tests replace this together with `sleep`. */
  now?: () => number;
}

export type DeploymentAction = "deploy" | "rollback" | "scale";

export type DeploymentStatus = "in_progress" | "succeeded" | "failed" | "timed_out" | "interrupted";

export interface DeploymentRecord {
  id: number;
  environment: string;
  app: string;
  action: DeploymentAction;
  /** Image after this change. */
  image: string;
  /** Image that was running before this change; null when the app was not deployed yet. */
  previousImage: string | null;
  replicas: number;
  status: DeploymentStatus;
  requestedBy: string;
  /** How it ended, for example why it failed. */
  message: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

/** What is known when a deployment starts. */
export type NewDeployment = Pick<
  DeploymentRecord,
  "environment" | "app" | "action" | "image" | "previousImage" | "replicas" | "requestedBy"
>;

export interface HistoryFilter {
  limit: number;
  requestedBy?: string;
  environment?: string;
}

export type Row = Record<string, unknown>;

export interface DeployParams {
  /** Name of the app; used for the Deployment, the Service and the "app" label. */
  name: string;
  /** Full image with version, for example "sample-app:v2". */
  image: string;
  replicas: number;
  /** Port the app listens on inside the container. */
  port: number;
  resources: { requests: ResourceAmounts; limits: ResourceAmounts };
}

export type OperationState = "running" | "succeeded" | "failed";

export interface Operation {
  id: string;
  /** The history row this operation belongs to. */
  deploymentId: number;
  environment: string;
  app: string;
  state: OperationState;
  /** Progress so far, oldest first: "1/3 pods ready", "2/3 pods ready", ... */
  steps: string[];
  /** The final message, once the operation is no longer running. */
  message: string;
}

export type NewOperation = Pick<Operation, "deploymentId" | "environment" | "app">;

export interface Target {
  /** The Kubernetes namespace of the environment. */
  namespace: string;
  /** The app's settings from the config file. */
  defaults: AppDefaults;
}
