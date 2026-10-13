import { inspectFolder } from "@/build/projectFolder.ts";
import { GIVE_UP_REASONS, STAGE_WORDS } from "@/constants/deployment.ts";
import { AppError, InvalidRequestError } from "@/errors.ts";
import type { FailureExplainer } from "@/services/failureExplainer.ts";
import { formatDeploymentId } from "@/services/historyStore.ts";
import type { HistoryStore } from "@/services/historyStore.ts";
import { buildManifests } from "@/services/manifestBuilder.ts";
import type { OperationStore } from "@/services/operationStore.ts";
import type { ServiceRegistry } from "@/services/serviceRegistry.ts";
import { findDeployment } from "@/services/target.ts";
import type { BuildTools, ImageBuilder, ProjectInfo } from "@/types/build.ts";
import type { ClusterGateway, PodInfo } from "@/types/cluster.ts";
import type { AppConfig } from "@/types/config.ts";
import type {
  ChangePlan,
  DeployParams,
  DeploymentServiceDeps,
  DeploymentStatus,
  OperationStage,
  StartedOperation,
} from "@/types/deployment.ts";
import type { ServiceSpec } from "@/types/service.ts";

export class DeploymentService {
  private readonly gateway: ClusterGateway;
  private readonly history: HistoryStore;
  private readonly operations: OperationStore;
  private readonly config: AppConfig;
  private readonly registry: ServiceRegistry;
  private readonly explainer: FailureExplainer;
  private readonly build: BuildTools;
  private readonly imageRegistry: string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(deps: DeploymentServiceDeps) {
    this.gateway = deps.gateway;
    this.history = deps.history;
    this.operations = deps.operations;
    this.config = deps.config;
    this.registry = deps.registry;
    this.explainer = deps.explainer;
    this.build = deps.build ?? { registry: "", builder: null, infra: null };
    this.imageRegistry = deps.imageRegistry ?? this.build.registry;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = deps.now ?? Date.now;
  }

  // ---- Step 1: planning ----

  async planDeploy(request: { environment: string; app: string; version: string }): Promise<ChangePlan> {
    const { namespace, spec } = this.registry.resolve(request.environment, request.app);
    const image = this.imageOf(spec, request.version);
    // Building the manifest checks the image and version; a bad one is refused right here.
    buildManifests(paramsFor(spec, image, spec.replicas));

    const current = await findDeployment(this.gateway, namespace, request.app);
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
      replicas: current?.desiredReplicas ?? spec.replicas,
      currentReplicas: current?.desiredReplicas ?? null,
    };
  }

  async planScale(request: { environment: string; app: string; replicas: number }): Promise<ChangePlan> {
    const { namespace, spec } = this.registry.resolve(request.environment, request.app);
    const current = await findDeployment(this.gateway, namespace, request.app);
    if (current === null) {
      throw new InvalidRequestError(
        `${request.app} is not deployed in ${request.environment} yet, so there is nothing to scale.`,
      );
    }
    if (!Number.isInteger(request.replicas) || request.replicas < 0) {
      throw new InvalidRequestError(`Replicas must be a whole number, 0 or more. I got ${request.replicas}.`);
    }
    if (request.replicas > spec.maxReplicas) {
      throw new InvalidRequestError(
        `${request.app} can have at most ${spec.maxReplicas} replicas. You asked for ${request.replicas}.`,
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
    const { namespace } = this.registry.resolve(request.environment, request.app);
    const current = await findDeployment(this.gateway, namespace, request.app);
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

  // ---- Planning for services built from a project folder ----

  /** Looks at a project folder for the chat's questions. Throws InvalidRequestError when it cannot be built. */
  inspectProject(path: string): ProjectInfo {
    return inspectFolder(path, this.config.build.allowedRoots);
  }

  /** The first deployment of a service made in the chat: its image is built from its folder. */
  async planCreate(spec: ServiceSpec): Promise<ChangePlan> {
    if (spec.folder === null) {
      throw new InvalidRequestError(`${spec.name} has no project folder to build from.`);
    }
    this.requireBuilder();
    if (this.registry.find(spec.environment, spec.name) !== null) {
      throw new InvalidRequestError(`There is already a service called ${spec.name} in ${spec.environment}.`);
    }
    const namespace = this.registry.namespaceOf(spec.environment);
    const { settings, image } = this.nextBuild(spec);
    if ((await findDeployment(this.gateway, namespace, spec.name)) !== null) {
      throw new InvalidRequestError(
        `A deployment called ${spec.name} already runs in ${spec.environment}, and I did not create it. Pick another name.`,
      );
    }
    return {
      action: "create",
      environment: spec.environment,
      namespace,
      app: spec.name,
      image,
      currentImage: null,
      replicas: settings.replicas,
      currentReplicas: null,
      spec: settings,
      buildFrom: spec.folder,
    };
  }

  /** A deploy without a version: builds the next version from the service's folder. */
  async planRebuild(request: { environment: string; app: string }): Promise<ChangePlan> {
    const { namespace, spec } = this.registry.resolve(request.environment, request.app);
    if (spec.folder === null) {
      throw new InvalidRequestError(
        `${request.app} is not built from a folder. Name the version to deploy, ` +
          `for example: deploy ${request.app} version v2 to ${request.environment}`,
      );
    }
    this.requireBuilder();
    const { settings, image } = this.nextBuild(spec);
    const current = await findDeployment(this.gateway, namespace, request.app);
    return {
      action: "deploy",
      environment: request.environment,
      namespace,
      app: request.app,
      image,
      currentImage: current?.image ?? null,
      replicas: current?.desiredReplicas ?? spec.replicas,
      currentReplicas: current?.desiredReplicas ?? null,
      spec: settings,
      buildFrom: spec.folder,
    };
  }

  /** New settings for a running service. The image and the number of replicas stay as they are. */
  async planConfigure(spec: ServiceSpec): Promise<ChangePlan> {
    const { namespace, spec: previous } = this.registry.resolve(spec.environment, spec.name);
    const current = await findDeployment(this.gateway, namespace, spec.name);
    if (current === null) {
      throw new InvalidRequestError(
        `${spec.name} is not running in ${spec.environment} yet, so there is nothing to change. ` +
          `To start it, type: deploy ${spec.name} to ${spec.environment}`,
      );
    }
    if (sameSettings(spec, previous)) {
      throw new InvalidRequestError(
        `${spec.name} in ${spec.environment} has exactly these settings already. Nothing to change.`,
      );
    }
    // Building the manifest checks the new values; a bad one is refused right here.
    buildManifests(paramsFor(spec, current.image, current.desiredReplicas));
    return {
      action: "configure",
      environment: spec.environment,
      namespace,
      app: spec.name,
      image: current.image,
      currentImage: current.image,
      replicas: current.desiredReplicas,
      currentReplicas: current.desiredReplicas,
      spec,
      previousSpec: previous,
    };
  }

  // ---- Step 2: carrying a plan out ----

  /**
   * Starts the change. Without a build it returns as soon as Kubernetes has accepted it;
   * with a build it returns at once and the build goes on in the background.
   */
  async execute(plan: ChangePlan, requestedBy: string): Promise<StartedOperation> {
    // A plan that sets the service's settings carries them; any other change uses the stored ones.
    const spec = plan.spec ?? this.registry.resolve(plan.environment, plan.app).spec;

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

    if (plan.buildFrom !== undefined) {
      return this.startBuild(plan, spec, plan.buildFrom, requestedBy);
    }

    const manifests = buildManifests(paramsFor(spec, plan.image, plan.replicas));

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
    // New settings are stored only once Kubernetes has accepted them.
    if (plan.spec !== undefined) {
      this.registry.save(plan.spec);
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

  // ---- Building the image first ----

  /** Records the change, takes the lock and returns; the build, the upload and the rollout follow in the background. */
  private startBuild(plan: ChangePlan, spec: ServiceSpec, folder: string, requestedBy: string): StartedOperation {
    const builder = this.requireBuilder();
    const record = this.history.start({
      environment: plan.environment,
      app: plan.app,
      action: plan.action,
      image: plan.image,
      previousImage: plan.currentImage,
      replicas: plan.replicas,
      requestedBy,
    });
    // Stored before the build, so a build that fails is tried again with "deploy <name> to
    // <environment>" instead of answering every question again.
    this.registry.save(spec);

    const stages: OperationStage[] =
      this.build.infra === null ? ["build", "publish", "pods"] : ["repository", "build", "publish", "pods"];
    const operation = this.operations.create({
      deploymentId: record.id,
      environment: plan.environment,
      app: plan.app,
      stages,
    });
    // Not awaited: a build takes minutes, and the caller must get its answer now.
    const done = this.buildThenRollOut(plan, spec, folder, builder, record.id, operation.id);
    return { operation, done };
  }

  /** Repository, build, upload, apply, and then the rollout. Never throws: a failure ends the operation. */
  private async buildThenRollOut(
    plan: ChangePlan,
    spec: ServiceSpec,
    folder: string,
    builder: ImageBuilder,
    deploymentId: number,
    operationId: string,
  ): Promise<void> {
    let stage: OperationStage = "build";
    const enter = (next: OperationStage): void => {
      stage = next;
      this.operations.setStage(operationId, next);
    };

    try {
      if (this.build.infra !== null) {
        enter("repository");
        await this.build.infra.ensure(spec.name);
      }
      enter("build");
      await builder.build(folder, plan.image);
      enter("publish");
      await builder.publish(plan.image);

      enter("pods");
      const manifests = buildManifests(paramsFor(spec, plan.image, plan.replicas));
      await this.gateway.applyService(plan.namespace, manifests.service);
      await this.gateway.applyDeployment(plan.namespace, manifests.deployment);
    } catch (error) {
      if (!(error instanceof AppError)) {
        console.error(`Unexpected error while ${STAGE_WORDS[stage]} for ${plan.app}:`, error);
      }
      const why = error instanceof AppError ? error.message : "an unexpected error (see the server log).";
      const message =
        `Deployment ${formatDeploymentId(deploymentId)} failed while ${STAGE_WORDS[stage]}: ${why} ` +
        `Fix it, then type "deploy ${plan.app} to ${plan.environment}" to try again.`;
      this.history.finish(deploymentId, "failed", message);
      this.operations.finish(operationId, "failed", message);
      return;
    }
    await this.followRollout(plan, deploymentId, operationId);
  }

  /** Throws InvalidRequestError when images cannot be built for the cluster in use. */
  assertCanBuild(): void {
    this.requireBuilder();
  }

  private requireBuilder(): ImageBuilder {
    if (this.build.builder === null) {
      throw new InvalidRequestError(
        "I can build images only for a kind cluster or an EKS cluster, and this cluster is neither.",
      );
    }
    return this.build.builder;
  }

  /** The settings and the image of the service's next build: "v3" after "v2". */
  private nextBuild(spec: ServiceSpec): { settings: ServiceSpec; image: string } {
    const version = this.registry.nextVersion(spec.name);
    const settings = { ...spec, lastVersion: version };
    const image = this.imageOf(settings, `v${version}`);
    // Building the manifest checks every setting; a bad one is refused right here.
    buildManifests(paramsFor(settings, image, settings.replicas));
    return { settings, image };
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
        // A settings change keeps the image, so old and new pods cannot be told apart by it:
        // there, Kubernetes' own count of replaced pods is the progress.
        const ready =
          plan.action === "configure"
            ? Math.min(deployment.updatedReplicas, deployment.readyReplicas)
            : wantedPods.filter((pod) => pod.ready).length;
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

  /** The service's full image name for one version: registry, repository and version. */
  private imageOf(spec: ServiceSpec, version: string): string {
    const registry = this.imageRegistry === "" ? "" : `${this.imageRegistry}/`;
    return `${registry}${spec.imageRepository}:${version}`;
  }

  /** After a failed deploy the old pods still serve; tell the user how to return to them. */
  private rollbackHint(plan: ChangePlan): string {
    if (plan.action === "configure") {
      return ` The pods with the old settings are still running. Type "edit ${plan.app} in ${plan.environment}" to change the setting back.`;
    }
    if (plan.action === "scale" || plan.currentImage === null) {
      return "";
    }
    return ` The old version is still running. Type "roll back ${plan.environment}" to return to ${plan.currentImage}.`;
  }
}

/** What the manifest builder needs: the service's settings, with the image and replicas of this change. */
function paramsFor(spec: ServiceSpec, image: string, replicas: number): DeployParams {
  return {
    name: spec.name,
    image,
    replicas,
    port: spec.port,
    resources: spec.resources,
    healthPath: spec.healthPath,
    env: spec.env,
  };
}

/** True when two versions of a service's settings would give the same pods. */
function sameSettings(a: ServiceSpec, b: ServiceSpec): boolean {
  const comparable = (spec: ServiceSpec): string =>
    JSON.stringify([
      spec.port,
      spec.healthPath,
      spec.maxReplicas,
      spec.resources.requests.cpu,
      spec.resources.requests.memory,
      spec.resources.limits.cpu,
      spec.resources.limits.memory,
      spec.env.map(({ name, value }) => [name, value]),
    ]);
  return comparable(a) === comparable(b);
}

function notReady(pods: PodInfo[]): PodInfo[] {
  return pods.filter((pod) => !pod.ready);
}
