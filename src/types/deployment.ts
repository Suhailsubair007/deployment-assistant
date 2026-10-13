import type { FailureExplainer } from "@/services/failureExplainer.ts";
import type { HistoryStore } from "@/services/historyStore.ts";
import type { OperationStore } from "@/services/operationStore.ts";
import type { ServiceRegistry } from "@/services/serviceRegistry.ts";
import type { ClusterGateway } from "@/types/cluster.ts";
import type { BuildTools } from "@/types/build.ts";
import type { AppConfig, ResourceAmounts } from "@/types/config.ts";
import type { EnvVar, ServiceSpec } from "@/types/service.ts";

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
  /** Set when the change sets the service's settings (create, settings change, rebuild): the settings afterwards. */
  spec?: ServiceSpec;
  /** Set for a settings change: the settings now, so the summary can show old and new. */
  previousSpec?: ServiceSpec;
  /** Set when the image does not exist yet: the project folder it is built from first. */
  buildFrom?: string;
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
  /** Where each service's settings come from. */
  registry: ServiceRegistry;
  explainer: FailureExplainer;
  /** Put in front of image names, for example an ECR registry. Left out, it is the registry of the build tools. */
  imageRegistry?: string;
  /** What builds an image from a project folder. Left out, nothing can be built. */
  build?: BuildTools;
  /** How to wait between two rollout checks. Tests replace this so they do not really wait. */
  sleep?: (ms: number) => Promise<void>;
  /** The current time in milliseconds. Tests replace this together with `sleep`. */
  now?: () => number;
}

/** "create" is the first deployment of a service made in the chat; "configure" changes its settings and keeps the image. */
export type DeploymentAction = "deploy" | "rollback" | "scale" | "create" | "configure";

export type DeploymentStatus = "in_progress" | "succeeded" | "failed" | "timed_out" | "interrupted";

export interface DeploymentRecord {
  id: number;
  /** The cluster the change was made on, by its name in the kubeconfig. */
  cluster: string;
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
  /** The path both probes call. Left out, it is "/health". */
  healthPath?: string;
  /** Variables handed to the app when it starts. Left out, there are none. */
  env?: EnvVar[];
}

export type OperationState = "running" | "succeeded" | "failed";

/** The parts of a change that builds an image, in the order they happen. */
export type OperationStage = "repository" | "build" | "publish" | "pods";

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
  /** Set for a change that builds an image: every stage it goes through. Left out, there is only the rollout. */
  stages?: OperationStage[];
  /** The stage that is running now, or the one that failed. */
  stage?: OperationStage;
}

export type NewOperation = Pick<Operation, "deploymentId" | "environment" | "app" | "stages">;
