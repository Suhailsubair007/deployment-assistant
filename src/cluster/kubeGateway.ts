import { AppsV1Api, CoreV1Api, KubeConfig, Metrics } from "@kubernetes/client-node";
import type { V1Deployment, V1Service } from "@kubernetes/client-node";

import { httpStatusOf, toAppError } from "@/cluster/kubeErrors.ts";
import {
  toDeploymentInfo,
  toEventInfo,
  toNodeInfo,
  toNodeUsage,
  toPodInfo,
  toPodUsage,
} from "@/cluster/kubeMappers.ts";
import { ClusterUnreachableError, MetricsUnavailableError } from "@/errors.ts";
import type {
  ClusterGateway,
  DeploymentInfo,
  EventInfo,
  HealthProbe,
  KubeClients,
  Manifest,
  NodeInfo,
  NodeUsage,
  PodInfo,
  PodUsage,
} from "@/types/cluster.ts";

export class KubeGateway implements ClusterGateway {
  private readonly context: string;
  private readonly clients: KubeClients | null;
  /** Why the kubeconfig could not be used. Empty when everything is fine. */
  private readonly setupProblem: string;

  constructor(requestedContext?: string) {
    const kubeConfig = new KubeConfig();
    kubeConfig.loadFromDefault();

    const available = kubeConfig.getContexts().map((context) => context.name);
    if (requestedContext && !available.includes(requestedContext)) {
      this.context = requestedContext;
      this.clients = null;
      this.setupProblem =
        `Your kubeconfig has no context named "${requestedContext}". ` +
        `Available contexts: ${available.join(", ") || "none"}.`;
      return;
    }
    if (requestedContext) {
      kubeConfig.setCurrentContext(requestedContext);
    }
    this.context = kubeConfig.getCurrentContext();

    try {
      this.clients = {
        apps: kubeConfig.makeApiClient(AppsV1Api),
        core: kubeConfig.makeApiClient(CoreV1Api),
        metrics: new Metrics(kubeConfig),
      };
      this.setupProblem = "";
    } catch {
      this.clients = null;
      this.setupProblem = "No cluster is set up in your kubeconfig. Create the local cluster with scripts/kind-up.sh.";
    }
  }

  /** Runs one or more library calls and turns any failure into a readable error. */
  private async call<T>(
    action: string,
    namespace: string | undefined,
    run: (clients: KubeClients) => Promise<T>,
  ): Promise<T> {
    if (this.clients === null) {
      throw new ClusterUnreachableError(this.setupProblem);
    }
    try {
      return await run(this.clients);
    } catch (error) {
      throw toAppError(error, { action, namespace, context: this.context });
    }
  }

  contextName(): string {
    return this.context;
  }

  namespaceExists(namespace: string): Promise<boolean> {
    return this.call("read the namespace", namespace, async ({ core }) => {
      try {
        await core.readNamespace({ name: namespace });
        return true;
      } catch (error) {
        if (httpStatusOf(error) === 404) {
          return false;
        }
        throw error;
      }
    });
  }

  async getDeployment(namespace: string, name: string): Promise<DeploymentInfo | null> {
    const deployment = await this.readDeployment(namespace, name);
    return deployment === null ? null : toDeploymentInfo(deployment);
  }

  private readDeployment(namespace: string, name: string): Promise<V1Deployment | null> {
    return this.call("read the deployment", namespace, async ({ apps }) => {
      try {
        return await apps.readNamespacedDeployment({ name, namespace });
      } catch (error) {
        if (httpStatusOf(error) === 404) {
          return null;
        }
        throw error;
      }
    });
  }

  async applyDeployment(namespace: string, manifest: Manifest): Promise<void> {
    const name = manifest.metadata.name;
    const body = manifest as V1Deployment;
    const existing = await this.readDeployment(namespace, name);

    if (existing === null) {
      await this.call("create the deployment", namespace, ({ apps }) =>
        apps.createNamespacedDeployment({ namespace, body }),
      );
      return;
    }
    const resourceVersion = existing.metadata?.resourceVersion;
    await this.call("update the deployment", namespace, ({ apps }) =>
      apps.replaceNamespacedDeployment({
        name,
        namespace,
        body: { ...body, metadata: { ...body.metadata, resourceVersion } },
      }),
    );
  }

  async applyService(namespace: string, manifest: Manifest): Promise<void> {
    const name = manifest.metadata.name;
    const body = manifest as V1Service;

    const existing = await this.call("read the service", namespace, async ({ core }) => {
      try {
        return await core.readNamespacedService({ name, namespace });
      } catch (error) {
        if (httpStatusOf(error) === 404) {
          return null;
        }
        throw error;
      }
    });

    if (existing === null) {
      await this.call("create the service", namespace, ({ core }) =>
        core.createNamespacedService({ namespace, body }),
      );
      return;
    }
    await this.call("update the service", namespace, ({ core }) =>
      core.replaceNamespacedService({
        name,
        namespace,
        body: {
          ...body,
          metadata: { ...body.metadata, resourceVersion: existing.metadata?.resourceVersion },
          spec: { ...body.spec, clusterIP: existing.spec?.clusterIP, clusterIPs: existing.spec?.clusterIPs },
        },
      }),
    );
  }

  listPods(namespace: string, appLabel: string): Promise<PodInfo[]> {
    return this.call("list pods", namespace, async ({ core }) => {
      const list = await core.listNamespacedPod({ namespace, labelSelector: `app=${appLabel}` });
      return (
        list.items
          // Pods that are being deleted (old pods during a rollout) are on their way out; leave them out.
          .filter((pod) => pod.metadata?.deletionTimestamp === undefined)
          .map(toPodInfo)
      );
    });
  }

  listPodEvents(namespace: string, podName: string): Promise<EventInfo[]> {
    return this.call("read pod events", namespace, async ({ core }) => {
      const list = await core.listNamespacedEvent({ namespace, fieldSelector: `involvedObject.name=${podName}` });
      return list.items
        .map(toEventInfo)
        .sort((first, second) => (first.at?.getTime() ?? 0) - (second.at?.getTime() ?? 0));
    });
  }

  tailPodLog(namespace: string, podName: string, lines: number, previous: boolean): Promise<string[]> {
    return this.call("read the pod log", namespace, async ({ core }) => {
      try {
        const text = await core.readNamespacedPodLog({ name: podName, namespace, tailLines: lines, previous });
        return text
          .split("\n")
          .map((line) => line.trimEnd())
          .filter((line) => line !== "");
      } catch (error) {
        // A container that has not started, or has no earlier run, has no log. That is not a failure.
        const status = httpStatusOf(error);
        if (status === 400 || status === 404) {
          return [];
        }
        throw error;
      }
    });
  }

  listPodMetrics(namespace: string): Promise<PodUsage[]> {
    return this.readMetrics(async (metrics) => (await metrics.getPodMetrics(namespace)).items.map(toPodUsage));
  }

  listNodes(): Promise<NodeInfo[]> {
    return this.call("list nodes", undefined, async ({ core }) => (await core.listNode()).items.map(toNodeInfo));
  }

  listNodeMetrics(): Promise<NodeUsage[]> {
    return this.readMetrics(async (metrics) => (await metrics.getNodeMetrics()).items.map(toNodeUsage));
  }

  /** Metrics calls fail in their own way: usually because metrics-server is missing or still starting. */
  private async readMetrics<T>(run: (metrics: Metrics) => Promise<T>): Promise<T> {
    if (this.clients === null) {
      throw new ClusterUnreachableError(this.setupProblem);
    }
    try {
      return await run(this.clients.metrics);
    } catch (error) {
      const status = httpStatusOf(error);
      const message = error instanceof Error ? error.message : "";
      if (status === 403 || message.includes("fetch failed")) {
        // Not a metrics-server problem: no permission, or the whole cluster is unreachable.
        const cause = status === 403 ? error : new TypeError("fetch failed");
        throw toAppError(cause, { action: "read CPU and memory usage", context: this.context });
      }
      throw new MetricsUnavailableError(
        "metrics-server is not installed or not ready in this cluster, so CPU and memory usage is not available.",
      );
    }
  }

  async getServiceHealth(namespace: string, service: string, port: number, timeoutMs: number): Promise<HealthProbe> {
    const startedAt = performance.now();
    const elapsedMs = (): number => Math.round(performance.now() - startedAt);

    const request = this.call("call /health through the service", namespace, async ({ core }) => {
      try {
        await core.connectGetNamespacedServiceProxyWithPath({ name: `${service}:${port}`, namespace, path: "health" });
        // The library only resolves for a 2xx answer.
        return { ok: true, statusCode: 200, responseMs: elapsedMs() };
      } catch (error) {
        const status = httpStatusOf(error);
        // 403 means RBAC stopped us; let that surface as a permission error.
        if (status !== null && status !== 403) {
          return { ok: false, statusCode: status, responseMs: elapsedMs() };
        }
        throw error;
      }
    });

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<HealthProbe>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, statusCode: null, responseMs: timeoutMs }), timeoutMs);
    });
    try {
      return await Promise.race([request, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
