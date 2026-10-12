// Collects the four health signals for an app from the cluster and has them judged.
// Also builds the short per-environment summary shown in the status panel.

import type { ClusterGateway, DeploymentInfo, HealthProbe, PodInfo } from "../cluster/gateway.ts";
import { thresholdsFor } from "../config.ts";
import type { AppConfig } from "../config.ts";
import { AppError } from "../errors.ts";
import type { FailureExplainer } from "./failureExplainer.ts";
import { evaluateHealth, findProblemPods } from "./healthEvaluator.ts";
import type { HealthReport, HealthStatus, PodProblem } from "./healthEvaluator.ts";
import type { HistoryStore } from "./historyStore.ts";
import { SERVICE_PORT } from "./manifestBuilder.ts";
import type { AppUsage, MetricsService, MetricsUnavailable } from "./metricsService.ts";
import { findDeployment, resolveTarget } from "./target.ts";

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

// Explaining a pod can take two calls (log and events). With many broken pods that
// adds up, so only the first few are explained and the rest are counted.
const MAX_EXPLAINED_PODS = 5;

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
