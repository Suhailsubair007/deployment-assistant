// Deploy, scale and roll back.
//
// Every change has two steps, matching the Confirm button in the chat:
//   1. plan...()  works out what would change. It reads the cluster but changes nothing.
//   2. execute()  carries the plan out: it takes the environment's lock, applies the
//                 manifests, and then follows the rollout in the background.

import type { ClusterGateway, DeploymentInfo, PodInfo } from "../cluster/gateway.ts";
import type { AppConfig, AppDefaults } from "../config.ts";
import { AppError, InvalidRequestError, NotFoundError } from "../errors.ts";
import type { FailureExplainer } from "./failureExplainer.ts";
import { formatDeploymentId } from "./historyStore.ts";
import type { DeploymentAction, DeploymentStatus, HistoryStore } from "./historyStore.ts";
import { buildManifests } from "./manifestBuilder.ts";
import type { Operation, OperationStore } from "./operationStore.ts";

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

// A new pod in one of these states will not recover by waiting, so the rollout stops early.
const GIVE_UP_REASONS = new Set(["ImagePullBackOff", "InvalidImageName", "CrashLoopBackOff"]);

export class DeploymentService {
  private readonly gateway: ClusterGateway;
  private readonly history: HistoryStore;
  private readonly operations: OperationStore;
  private readonly config: AppConfig;
  private readonly explainer: FailureExplainer;
  private readonly imageRegistry: string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(deps: DeploymentServiceDeps) {
    this.gateway = deps.gateway;
    this.history = deps.history;
    this.operations = deps.operations;
    this.config = deps.config;
    this.explainer = deps.explainer;
    this.imageRegistry = deps.imageRegistry ?? "";
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = deps.now ?? Date.now;
  }

  // ---- Step 1: planning ----

  async planDeploy(request: { environment: string; app: string; version: string }): Promise<ChangePlan> {
    const { namespace, defaults } = this.settingsFor(request.environment, request.app);
    const registry = this.imageRegistry === "" ? "" : `${this.imageRegistry}/`;
    const image = `${registry}${defaults.imageRepository}:${request.version}`;
    // Building the manifest checks the image and version; a bad one is refused right here.
    buildManifests({ name: request.app, image, replicas: defaults.replicas, port: defaults.port, resources: defaults.resources });

    const current = await this.currentDeployment(namespace, request.app);
    if (current?.image === image) {
      throw new InvalidRequestError(`${image} is already running in ${request.environment}. Nothing to deploy.`);
    }
    return {
      action: "deploy",
      environment: request.environment,
      namespace,
      app: request.app,
      image,
      currentImage: current?.image ?? null,
      // A deploy changes the version, not the size: keep the replicas the app already has.
      replicas: current?.desiredReplicas ?? defaults.replicas,
      currentReplicas: current?.desiredReplicas ?? null,
    };
  }

  async planScale(request: { environment: string; app: string; replicas: number }): Promise<ChangePlan> {
    const { namespace, defaults } = this.settingsFor(request.environment, request.app);
    const current = await this.currentDeployment(namespace, request.app);
    if (current === null) {
      throw new InvalidRequestError(
        `${request.app} is not deployed in ${request.environment} yet, so there is nothing to scale.`,
      );
    }
    if (!Number.isInteger(request.replicas) || request.replicas < 0) {
      throw new InvalidRequestError(`Replicas must be a whole number, 0 or more. I got ${request.replicas}.`);
    }
    if (request.replicas > defaults.maxReplicas) {
      throw new InvalidRequestError(
        `${request.app} can have at most ${defaults.maxReplicas} replicas (maxReplicas in the config file). You asked for ${request.replicas}.`,
      );
    }
    if (request.replicas === current.desiredReplicas) {
      throw new InvalidRequestError(
        `${request.app} in ${request.environment} already has ${current.desiredReplicas} replicas.`,
      );
    }
    return {
      action: "scale",
      environment: request.environment,
      namespace,
      app: request.app,
      image: current.image,
      currentImage: current.image,
      replicas: request.replicas,
      currentReplicas: current.desiredReplicas,
    };
  }

  async planRollback(request: { environment: string; app: string }): Promise<ChangePlan> {
    const { namespace } = this.settingsFor(request.environment, request.app);
    const current = await this.currentDeployment(namespace, request.app);
    // "Previous" means: the image that was running before the most recent deploy or rollback.
    const lastChange = this.history.latestImageChange(request.environment, request.app);
    if (current === null || lastChange === null || lastChange.previousImage === null) {
      throw new InvalidRequestError(
        `There is no earlier deployment of ${request.app} in ${request.environment} to roll back to.`,
      );
    }
    if (lastChange.previousImage === current.image) {
      throw new InvalidRequestError(`${request.environment} already runs ${current.image}. Nothing to roll back.`);
    }
    return {
      action: "rollback",
      environment: request.environment,
      namespace,
      app: request.app,
      image: lastChange.previousImage,
      currentImage: current.image,
      replicas: current.desiredReplicas,
      currentReplicas: current.desiredReplicas,
    };
  }

  // ---- Step 2: carrying a plan out ----

  /**
   * Starts the change and returns as soon as Kubernetes has accepted it.
   * Throws when the change cannot start: the environment is busy, it changed since
   * the plan was made, or Kubernetes refused the manifests.
   */
  async execute(plan: ChangePlan, requestedBy: string): Promise<StartedOperation> {
    const { defaults } = this.settingsFor(plan.environment, plan.app);

    // Gives the right message when another change is plainly still running.
    this.history.assertFree(plan.environment);

    // The user confirmed a summary. If the cluster no longer matches it, do not go ahead.
    const current = await this.gateway.getDeployment(plan.namespace, plan.app);
    const currentImage = current?.image ?? null;
    const currentReplicas = current?.desiredReplicas ?? null;
    if (currentImage !== plan.currentImage || currentReplicas !== plan.currentReplicas) {
      const now =
        current === null
          ? `${plan.app} is no longer deployed there`
          : `it now runs ${current.image} with ${current.desiredReplicas} replicas`;
      throw new InvalidRequestError(
        `${plan.environment} changed after I showed you the summary (${now}). Please ask again.`,
      );
    }

    const manifests = buildManifests({
      name: plan.app,
      image: plan.image,
      replicas: plan.replicas,
      port: defaults.port,
      resources: defaults.resources,
    });

    // This is the lock. If two requests reach this line together, the database lets
    // exactly one of them insert its row; the other gets DeployInProgressError.
    const record = this.history.start({
      environment: plan.environment,
      app: plan.app,
      action: plan.action,
      image: plan.image,
      previousImage: plan.currentImage,
      replicas: plan.replicas,
      requestedBy,
    });

    try {
      await this.gateway.applyService(plan.namespace, manifests.service);
      await this.gateway.applyDeployment(plan.namespace, manifests.deployment);
    } catch (error) {
      this.history.finish(record.id, "failed", error instanceof Error ? error.message : String(error));
      throw error;
    }

    const operation = this.operations.create({
      deploymentId: record.id,
      environment: plan.environment,
      app: plan.app,
    });
    // Not awaited: the rollout can take minutes, and the caller must get its answer now.
    const done = this.followRollout(plan, record.id, operation.id);
    return { operation, done };
  }

  // ---- Following the rollout ----

  /** Checks the rollout every few seconds until it finishes, fails or times out. Never throws. */
  private async followRollout(plan: ChangePlan, deploymentId: number, operationId: string): Promise<void> {
    const id = formatDeploymentId(deploymentId);
    const { rolloutSeconds, pollIntervalMs } = this.config.timeouts;
    const deadline = this.now() + rolloutSeconds * 1000;

    const end = (status: Exclude<DeploymentStatus, "in_progress">, message: string): void => {
      this.history.finish(deploymentId, status, message);
      this.operations.finish(operationId, status === "succeeded" ? "succeeded" : "failed", message);
    };

    try {
      for (;;) {
        const deployment = await this.gateway.getDeployment(plan.namespace, plan.app);
        if (deployment === null) {
          end("failed", `The deployment was deleted while it was rolling out. Deployment ID: ${id}`);
          return;
        }

        // Progress = pods that run the wanted image and are ready to serve.
        const pods = await this.gateway.listPods(plan.namespace, plan.app);
        const wantedPods = pods.filter((pod) => pod.image === plan.image);
        const ready = wantedPods.filter((pod) => pod.ready).length;
        const progress = `${ready}/${plan.replicas} pods ready`;
        this.operations.addStep(operationId, progress);

        if (deployment.rolloutObserved && ready === plan.replicas) {
          end("succeeded", `${progress}. Deployment ID: ${id}`);
          return;
        }

        const hopeless = wantedPods.find(
          (pod) => pod.waitingReason !== undefined && GIVE_UP_REASONS.has(pod.waitingReason),
        );
        if (hopeless !== undefined) {
          const why = (await this.explainer.explain(plan.namespace, hopeless)) ?? "The new pods did not start.";
          end("failed", `Deployment ${id} failed: ${why}${this.rollbackHint(plan)}`);
          return;
        }

        if (this.now() >= deadline) {
          const why = await this.explainer.explainFirstProblem(plan.namespace, notReady(wantedPods));
          const versionNote = plan.action === "scale" ? "" : " on the new version";
          end(
            "timed_out",
            `The rollout did not finish in ${rolloutSeconds} seconds: ${progress}${versionNote}.` +
              `${why === null ? "" : ` ${why}`}${this.rollbackHint(plan)} Deployment ID: ${id}`,
          );
          return;
        }

        await this.sleep(pollIntervalMs);
      }
    } catch (error) {
      // For example the cluster became unreachable half-way through.
      if (!(error instanceof AppError)) {
        console.error(`Unexpected error while following rollout ${id}:`, error);
      }
      const why = error instanceof AppError ? error.message : "an unexpected error (see the server log).";
      end("failed", `I lost track of the rollout: ${why} Deployment ID: ${id}`);
    }
  }

  /** After a failed deploy the old pods still serve; tell the user how to return to them. */
  private rollbackHint(plan: ChangePlan): string {
    if (plan.action === "scale" || plan.currentImage === null) {
      return "";
    }
    return ` The old version is still running. Type "roll back ${plan.environment}" to return to ${plan.currentImage}.`;
  }

  // ---- Helpers ----

  private settingsFor(environment: string, app: string): { namespace: string; defaults: AppDefaults } {
    if (!Object.hasOwn(this.config.environments, environment)) {
      const known = Object.keys(this.config.environments).join(", ");
      throw new InvalidRequestError(`There is no environment called "${environment}". I know: ${known}.`);
    }
    if (!Object.hasOwn(this.config.apps, app)) {
      const known = Object.keys(this.config.apps).join(", ");
      throw new InvalidRequestError(`I don't know an app called "${app}". I know: ${known}.`);
    }
    return { namespace: this.config.environments[environment].namespace, defaults: this.config.apps[app] };
  }

  /** The app's Deployment, or null when it is not deployed. Fails when the namespace itself is missing. */
  private async currentDeployment(namespace: string, app: string): Promise<DeploymentInfo | null> {
    const deployment = await this.gateway.getDeployment(namespace, app);
    if (deployment === null && !(await this.gateway.namespaceExists(namespace))) {
      throw new NotFoundError(`Namespace "${namespace}" does not exist in this cluster.`, "namespaces");
    }
    return deployment;
  }
}

function notReady(pods: PodInfo[]): PodInfo[] {
  return pods.filter((pod) => !pod.ready);
}
