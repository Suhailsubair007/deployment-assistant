// CPU and memory: what each pod uses right now, compared with what it asked for
// (requests) and what it may use at most (limits). Also the same for nodes.
//
// Usage comes from metrics-server. When it is missing, the result says so; a number
// is never invented.

import type { ClusterGateway, ContainerResources, PodInfo } from "../cluster/gateway.ts";
import { MetricsUnavailableError } from "../errors.ts";
import { parseCpuToMillicores, parseMemoryToBytes, percent } from "./units.ts";

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

  /**
   * @param pods the app's pods, when the caller has already listed them
   */
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
