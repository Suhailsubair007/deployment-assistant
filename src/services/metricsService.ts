import { MetricsUnavailableError } from "@/errors.ts";
import { parseCpuToMillicores, parseMemoryToBytes, percent } from "@/services/units.ts";
import type { ClusterGateway, ContainerResources, PodInfo } from "@/types/cluster.ts";
import type { AppUsage, MetricsUnavailable, NodesReport, PodUsageReport, ResourceUse } from "@/types/monitoring.ts";

function resourceUse(used: number, request: number | null, limit: number | null): ResourceUse {
  return {
    used,
    request,
    limit,
    percentOfRequest: request === null ? null : percent(used, request),
    percentOfLimit: limit === null ? null : percent(used, limit),
  };
}

/** Adds up numbers; the sum is null as soon as one of them is unknown. */
function sumOrNull(values: (number | null)[]): number | null {
  let total = 0;
  for (const value of values) {
    if (value === null) {
      return null;
    }
    total += value;
  }
  return total;
}

/** A pod's request or limit is the sum over its containers; unknown if any container sets none. */
function podAmount(
  containers: ContainerResources[],
  kind: "requests" | "limits",
  resource: "cpu" | "memory",
): number | null {
  const parse = resource === "cpu" ? parseCpuToMillicores : parseMemoryToBytes;
  return sumOrNull(
    containers.map((container) => {
      const quantity = container[kind][resource];
      return quantity === undefined ? null : parse(quantity);
    }),
  );
}

export class MetricsService {
  private readonly gateway: ClusterGateway;

  constructor(gateway: ClusterGateway) {
    this.gateway = gateway;
  }

  async getAppUsage(namespace: string, app: string, pods?: PodInfo[]): Promise<AppUsage | MetricsUnavailable> {
    const appPods = pods ?? (await this.gateway.listPods(namespace, app));

    let metrics;
    try {
      metrics = await this.gateway.listPodMetrics(namespace);
    } catch (error) {
      if (error instanceof MetricsUnavailableError) {
        return { available: false, reason: error.message };
      }
      throw error;
    }

    const reports: PodUsageReport[] = [];
    const podsWithoutMetrics: string[] = [];
    for (const pod of appPods) {
      const usage = metrics.find((metric) => metric.podName === pod.name);
      if (usage === undefined) {
        podsWithoutMetrics.push(pod.name);
        continue;
      }
      const cpuUsed = usage.containers.reduce((sum, container) => sum + parseCpuToMillicores(container.cpu), 0);
      const memoryUsed = usage.containers.reduce((sum, container) => sum + parseMemoryToBytes(container.memory), 0);

      const report: PodUsageReport = {
        podName: pod.name,
        restarts: pod.restarts,
        cpu: resourceUse(
          cpuUsed,
          podAmount(pod.containers, "requests", "cpu"),
          podAmount(pod.containers, "limits", "cpu"),
        ),
        memory: resourceUse(
          memoryUsed,
          podAmount(pod.containers, "requests", "memory"),
          podAmount(pod.containers, "limits", "memory"),
        ),
      };
      if (pod.lastTerminationReason !== undefined) {
        report.lastTerminationReason = pod.lastTerminationReason;
      }
      reports.push(report);
    }

    const totalOf = (resource: "cpu" | "memory"): ResourceUse =>
      resourceUse(
        reports.reduce((sum, report) => sum + report[resource].used, 0),
        sumOrNull(reports.map((report) => report[resource].request)),
        sumOrNull(reports.map((report) => report[resource].limit)),
      );

    return {
      available: true,
      pods: reports,
      podsWithoutMetrics,
      total: { cpu: totalOf("cpu"), memory: totalOf("memory") },
    };
  }

  /** Nodes are always listed. Their usage percentages are null when metrics-server is unavailable. */
  async getNodes(): Promise<NodesReport> {
    const nodes = await this.gateway.listNodes();

    let usage: Awaited<ReturnType<ClusterGateway["listNodeMetrics"]>> = [];
    let metricsUnavailableReason: string | null = null;
    try {
      usage = await this.gateway.listNodeMetrics();
    } catch (error) {
      if (!(error instanceof MetricsUnavailableError)) {
        throw error;
      }
      metricsUnavailableReason = error.message;
    }

    return {
      metricsUnavailableReason,
      nodes: nodes.map((node) => {
        const used = usage.find((metric) => metric.nodeName === node.name);
        return {
          name: node.name,
          ready: node.ready,
          memoryPressure: node.memoryPressure,
          diskPressure: node.diskPressure,
          cpuPercent:
            used === undefined
              ? null
              : percent(parseCpuToMillicores(used.cpu), parseCpuToMillicores(node.allocatable.cpu)),
          memoryPercent:
            used === undefined
              ? null
              : percent(parseMemoryToBytes(used.memory), parseMemoryToBytes(node.allocatable.memory)),
        };
      }),
    };
  }
}
