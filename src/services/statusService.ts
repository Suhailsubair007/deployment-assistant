import { thresholdsFor } from "@/config.ts";
import { SERVICE_PORT } from "@/constants/deployment.ts";
import { MAX_EXPLAINED_PODS } from "@/constants/monitoring.ts";
import { AppError } from "@/errors.ts";
import type { FailureExplainer } from "@/services/failureExplainer.ts";
import { evaluateHealth, findProblemPods } from "@/services/healthEvaluator.ts";
import type { HistoryStore } from "@/services/historyStore.ts";
import type { MetricsService } from "@/services/metricsService.ts";
import { findDeployment, resolveTarget } from "@/services/target.ts";
import type { ClusterGateway, PodInfo } from "@/types/cluster.ts";
import type { AppConfig } from "@/types/config.ts";
import type {
  AppStatus,
  AppUsage,
  EnvironmentSummary,
  MetricsUnavailable,
  NodesReport,
  PodProblem,
  StatusServiceDeps,
} from "@/types/monitoring.ts";

export class StatusService {
  private readonly gateway: ClusterGateway;
  private readonly metrics: MetricsService;
  private readonly explainer: FailureExplainer;
  private readonly history: HistoryStore;
  private readonly config: AppConfig;
  private readonly now: () => Date;

  constructor(deps: StatusServiceDeps) {
    this.gateway = deps.gateway;
    this.metrics = deps.metrics;
    this.explainer = deps.explainer;
    this.history = deps.history;
    this.config = deps.config;
    this.now = deps.now ?? (() => new Date());
  }

  /** Returns null when the app is not deployed in that environment. */
  async getStatus(environment: string, app: string): Promise<AppStatus | null> {
    const { namespace } = resolveTarget(this.config, environment, app);
    const deployment = await findDeployment(this.gateway, namespace, app);
    if (deployment === null) {
      return null;
    }

    const pods = await this.gateway.listPods(namespace, app);
    // These two do not depend on each other, so they run at the same time.
    const [probe, usage] = await Promise.all([
      this.gateway.getServiceHealth(namespace, app, SERVICE_PORT, this.config.timeouts.healthRequestMs),
      this.metrics.getAppUsage(namespace, app, pods),
    ]);

    const thresholds = thresholdsFor(this.config, environment);
    const problemPods = findProblemPods(pods, thresholds, this.now());
    const podProblems = await Promise.all(
      problemPods.slice(0, MAX_EXPLAINED_PODS).map(async (pod): Promise<PodProblem> => {
        const explanation = (await this.explainer.explain(namespace, pod)) ?? this.plainState(pod);
        return { podName: pod.name, explanation };
      }),
    );

    const health = evaluateHealth({ app, deployment, probe, usage, podProblems }, thresholds);
    const notExplained = problemPods.length - podProblems.length;
    if (notExplained > 0) {
      health.reasons.push(`${notExplained} more pod${notExplained === 1 ? " has" : "s have"} problems.`);
    }
    return { environment, app, health, deployment, pods, probe, usage };
  }

  /** CPU and memory of the app's pods only. Returns null when the app is not deployed. */
  async getUsage(environment: string, app: string): Promise<AppUsage | MetricsUnavailable | null> {
    const { namespace } = resolveTarget(this.config, environment, app);
    if ((await findDeployment(this.gateway, namespace, app)) === null) {
      return null;
    }
    return this.metrics.getAppUsage(namespace, app);
  }

  getNodes(): Promise<NodesReport> {
    return this.metrics.getNodes();
  }

  /** Name of the cluster every status here is read from. */
  clusterName(): string {
    return this.gateway.clusterName();
  }

  /** One summary per environment and app. A failure in one environment does not hide the others. */
  getSummaries(): Promise<EnvironmentSummary[]> {
    const targets = Object.keys(this.config.environments).flatMap((environment) =>
      Object.keys(this.config.apps).map((app) => ({ environment, app })),
    );
    return Promise.all(targets.map(({ environment, app }) => this.summarise(environment, app)));
  }

  private async summarise(environment: string, app: string): Promise<EnvironmentSummary> {
    const lastChange = this.history.latest(environment, app);
    const lastUpdate = lastChange === null ? null : (lastChange.finishedAt ?? lastChange.startedAt);
    try {
      const status = await this.getStatus(environment, app);
      if (status === null) {
        return {
          environment,
          app,
          status: "NOT DEPLOYED",
          reason: `${app} is not deployed in ${environment} yet.`,
          image: null,
          lastUpdate,
        };
      }
      return {
        environment,
        app,
        status: status.health.status,
        reason: status.health.reasons[0] ?? "",
        image: status.deployment.image,
        lastUpdate,
      };
    } catch (error) {
      if (!(error instanceof AppError)) {
        throw error;
      }
      return { environment, app, status: "UNKNOWN", reason: error.message, image: null, lastUpdate };
    }
  }

  /** Used when a pod counts as a problem but Kubernetes gives no reason to quote. */
  private plainState(pod: PodInfo): string {
    if (pod.phase === "Pending") {
      const seconds = Math.round((this.now().getTime() - pod.createdAt.getTime()) / 1000);
      return `Pending for ${seconds} seconds.`;
    }
    if (pod.restarts > 0) {
      return `Restarted ${pod.restarts} time${pod.restarts === 1 ? "" : "s"}.`;
    }
    return `Not working (${pod.waitingReason ?? pod.phase}).`;
  }
}
