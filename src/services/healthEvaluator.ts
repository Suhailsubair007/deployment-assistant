// Decides whether an app is HEALTHY, DEGRADED or DOWN.
//
// Four signals are combined and the worst one wins:
//   1. rollout    pods available compared with pods wanted
//   2. pods       crash loops, image errors, stuck Pending, many restarts, recent OOMKills
//   3. /health    an HTTP call through the Service, with its response time
//   4. resources  CPU and memory use compared with the limits
//
// Everything here is a pure function: same input, same answer, no cluster needed.
// Every number it compares against comes from the thresholds in the config file.

import type { DeploymentInfo, HealthProbe, PodInfo } from "../cluster/gateway.ts";
import type { Thresholds } from "../config.ts";
import { NORMAL_STARTUP } from "./failureExplainer.ts";
import type { AppUsage, MetricsUnavailable, PodUsageReport } from "./metricsService.ts";

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

const SEVERITY: Record<HealthStatus, number> = { HEALTHY: 0, DEGRADED: 1, DOWN: 2 };

/** The pods that count as having a problem (signal 2). */
export function findProblemPods(pods: PodInfo[], thresholds: Thresholds, now: Date): PodInfo[] {
  return pods.filter((pod) => {
    // Waiting for a failure reason such as CrashLoopBackOff or ImagePullBackOff.
    if (pod.waitingReason !== undefined && !NORMAL_STARTUP.has(pod.waitingReason)) {
      return true;
    }
    // Pending is normal for a moment; staying there is not.
    const ageSeconds = (now.getTime() - pod.createdAt.getTime()) / 1000;
    if (pod.phase === "Pending" && ageSeconds > thresholds.pendingSeconds) {
      return true;
    }
    if (pod.restarts > thresholds.restartCount) {
      return true;
    }
    // An OOMKill stops counting once it is old; without a time we cannot call it old.
    if (pod.lastTerminationReason === "OOMKilled") {
      const minutesSince =
        pod.lastTerminatedAt === undefined ? 0 : (now.getTime() - pod.lastTerminatedAt.getTime()) / 60_000;
      return minutesSince <= thresholds.oomKillWindowMinutes;
    }
    return false;
  });
}

/** The pod with the highest percentage of its limit for one resource, or null when no pod has a limit. */
function busiest(
  pods: PodUsageReport[],
  resource: "cpu" | "memory",
): { podName: string; percentOfLimit: number } | null {
  let top: { podName: string; percentOfLimit: number } | null = null;
  for (const pod of pods) {
    const percentOfLimit = pod[resource].percentOfLimit;
    if (percentOfLimit !== null && (top === null || percentOfLimit > top.percentOfLimit)) {
      top = { podName: pod.podName, percentOfLimit };
    }
  }
  return top;
}

export function evaluateHealth(input: HealthInput, thresholds: Thresholds): HealthReport {
  const { app, deployment, probe, usage, podProblems } = input;
  const reasons: string[] = [];
  const notes: string[] = [];
  let status: HealthStatus = "HEALTHY";

  /** Records a reason and raises the status if this signal is worse than what we have so far. */
  const worsen = (to: HealthStatus, reason: string): void => {
    reasons.push(reason);
    if (SEVERITY[to] > SEVERITY[status]) {
      status = to;
    }
  };

  // 1. Rollout
  const wanted = deployment.desiredReplicas;
  const available = deployment.availableReplicas;
  if (wanted === 0) {
    worsen("DOWN", `${app} is scaled to 0 replicas.`);
  } else if (available === 0) {
    worsen("DOWN", `No pods are available (0 of ${wanted}).`);
  } else if (available < wanted) {
    worsen("DEGRADED", `Only ${available} of ${wanted} pods are available.`);
  }

  // 2. Pods
  for (const problem of podProblems) {
    worsen("DEGRADED", `${problem.podName}: ${problem.explanation}`);
  }

  // 3. /health
  if (!probe.ok) {
    worsen(
      "DOWN",
      probe.statusCode === null
        ? `/health did not answer within ${probe.responseMs} ms.`
        : `/health answered with status ${probe.statusCode}.`,
    );
  } else if (probe.responseMs > thresholds.healthResponseMs) {
    worsen("DEGRADED", `/health is slow: ${probe.responseMs} ms (threshold ${thresholds.healthResponseMs} ms).`);
  }

  // 4. Resources. High use is a warning, never DOWN by itself.
  if (!usage.available) {
    notes.push(usage.reason);
  } else {
    const memory = busiest(usage.pods, "memory");
    if (memory !== null && memory.percentOfLimit > thresholds.memoryPercentOfLimit) {
      worsen(
        "DEGRADED",
        `${memory.podName} uses ${memory.percentOfLimit}% of its memory limit (threshold ${thresholds.memoryPercentOfLimit}%).`,
      );
    }
    const cpu = busiest(usage.pods, "cpu");
    if (cpu !== null && cpu.percentOfLimit > thresholds.cpuPercentOfLimit) {
      worsen(
        "DEGRADED",
        `${cpu.podName} uses ${cpu.percentOfLimit}% of its CPU limit (threshold ${thresholds.cpuPercentOfLimit}%).`,
      );
    }
    const missing = usage.podsWithoutMetrics.length;
    if (missing > 0) {
      notes.push(
        `No usage numbers yet for ${missing} pod${missing === 1 ? "" : "s"} (metrics-server needs a minute or two after a pod starts).`,
      );
    }
  }

  return { status, reasons, notes };
}
