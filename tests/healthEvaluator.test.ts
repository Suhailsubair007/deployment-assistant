import assert from "node:assert/strict";
import { test } from "node:test";

import type { DeploymentInfo, PodInfo } from "@/types/cluster.ts";
import type { Thresholds } from "@/types/config.ts";
import { evaluateHealth, findProblemPods } from "@/services/healthEvaluator.ts";
import type { HealthInput } from "@/types/monitoring.ts";
import type { AppUsage, PodUsageReport, ResourceUse } from "@/types/monitoring.ts";

const thresholds: Thresholds = {
  memoryPercentOfLimit: 85,
  cpuPercentOfLimit: 90,
  restartCount: 3,
  oomKillWindowMinutes: 30,
  healthResponseMs: 1000,
  pendingSeconds: 60,
};

const NOW = new Date("2026-10-12T12:00:00Z");
const minutesAgo = (minutes: number): Date => new Date(NOW.getTime() - minutes * 60_000);

function deployment(overrides: Partial<DeploymentInfo> = {}): DeploymentInfo {
  return {
    name: "sample-app",
    namespace: "staging",
    image: "sample-app:v2",
    desiredReplicas: 3,
    updatedReplicas: 3,
    readyReplicas: 3,
    availableReplicas: 3,
    rolloutObserved: true,
    ...overrides,
  };
}

function use(percentOfLimit: number): ResourceUse {
  return { used: percentOfLimit, request: 50, limit: 100, percentOfRequest: percentOfLimit * 2, percentOfLimit };
}

function podUsage(podName: string, cpuPercent: number, memoryPercent: number): PodUsageReport {
  return { podName, restarts: 0, cpu: use(cpuPercent), memory: use(memoryPercent) };
}

function usage(pods: PodUsageReport[]): AppUsage {
  return { available: true, pods, podsWithoutMetrics: [], total: { cpu: use(0), memory: use(0) } };
}

/** Everything fine: 3 of 3 pods, /health in 62 ms, low resource use. Tests change one thing at a time. */
function input(overrides: Partial<HealthInput> = {}): HealthInput {
  return {
    app: "sample-app",
    deployment: deployment(),
    probe: { ok: true, statusCode: 200, responseMs: 62 },
    usage: usage([podUsage("pod-a", 14, 50), podUsage("pod-b", 20, 40)]),
    podProblems: [],
    ...overrides,
  };
}

// ---- The overall decision ----

test("all signals clean is HEALTHY with no reasons", () => {
  assert.deepEqual(evaluateHealth(input(), thresholds), { status: "HEALTHY", reasons: [], notes: [] });
});

test("fewer pods available than wanted is DEGRADED", () => {
  const report = evaluateHealth(input({ deployment: deployment({ availableReplicas: 2 }) }), thresholds);

  assert.equal(report.status, "DEGRADED");
  assert.deepEqual(report.reasons, ["Only 2 of 3 pods are available."]);
});

test("no pods available is DOWN", () => {
  const report = evaluateHealth(input({ deployment: deployment({ availableReplicas: 0 }) }), thresholds);

  assert.equal(report.status, "DOWN");
  assert.deepEqual(report.reasons, ["No pods are available (0 of 3)."]);
});

test("an app scaled to zero is DOWN and says it was scaled to zero", () => {
  const scaledToZero = deployment({ desiredReplicas: 0, availableReplicas: 0, readyReplicas: 0, updatedReplicas: 0 });

  const report = evaluateHealth(input({ deployment: scaledToZero }), thresholds);

  assert.equal(report.status, "DOWN");
  assert.equal(report.reasons[0], "sample-app is scaled to 0 replicas.");
});

test("/health giving no answer is DOWN", () => {
  const report = evaluateHealth(input({ probe: { ok: false, statusCode: null, responseMs: 3000 } }), thresholds);

  assert.equal(report.status, "DOWN");
  assert.deepEqual(report.reasons, ["/health did not answer within 3000 ms."]);
});

test("/health answering with an error status is DOWN", () => {
  const report = evaluateHealth(input({ probe: { ok: false, statusCode: 503, responseMs: 12 } }), thresholds);

  assert.equal(report.status, "DOWN");
  assert.deepEqual(report.reasons, ["/health answered with status 503."]);
});

test("/health slower than the threshold is DEGRADED", () => {
  const report = evaluateHealth(input({ probe: { ok: true, statusCode: 200, responseMs: 1400 } }), thresholds);

  assert.equal(report.status, "DEGRADED");
  assert.deepEqual(report.reasons, ["/health is slow: 1400 ms (threshold 1000 ms)."]);
});

test("a pod with a problem is DEGRADED and the explanation names the pod", () => {
  const podProblems = [{ podName: "pod-c", explanation: "Image sample-app:v9 was not found, or the cluster is not allowed to pull it." }];

  const report = evaluateHealth(input({ podProblems }), thresholds);

  assert.equal(report.status, "DEGRADED");
  assert.deepEqual(report.reasons, [
    "pod-c: Image sample-app:v9 was not found, or the cluster is not allowed to pull it.",
  ]);
});

test("memory above the threshold on any pod is DEGRADED and names the busiest pod", () => {
  const hot = usage([podUsage("pod-a", 14, 50), podUsage("pod-b", 20, 91), podUsage("pod-c", 10, 88)]);

  const report = evaluateHealth(input({ usage: hot }), thresholds);

  assert.equal(report.status, "DEGRADED");
  assert.deepEqual(report.reasons, ["pod-b uses 91% of its memory limit (threshold 85%)."]);
});

test("memory exactly at the threshold is still HEALTHY", () => {
  const atThreshold = usage([podUsage("pod-a", 14, 85)]);

  assert.equal(evaluateHealth(input({ usage: atThreshold }), thresholds).status, "HEALTHY");
});

test("CPU above the threshold is DEGRADED", () => {
  const busy = usage([podUsage("pod-a", 96, 50)]);

  const report = evaluateHealth(input({ usage: busy }), thresholds);

  assert.equal(report.status, "DEGRADED");
  assert.deepEqual(report.reasons, ["pod-a uses 96% of its CPU limit (threshold 90%)."]);
});

test("a lower threshold for one environment changes the decision", () => {
  const seventyFive = usage([podUsage("pod-a", 14, 75)]);
  const prodThresholds = { ...thresholds, memoryPercentOfLimit: 70 };

  assert.equal(evaluateHealth(input({ usage: seventyFive }), thresholds).status, "HEALTHY");
  assert.equal(evaluateHealth(input({ usage: seventyFive }), prodThresholds).status, "DEGRADED");
});

test("missing metrics do not change the status; the report notes what was not checked", () => {
  const unavailable = { available: false as const, reason: "metrics-server is not installed in this cluster, so CPU and memory usage is not available." };

  const report = evaluateHealth(input({ usage: unavailable }), thresholds);

  assert.equal(report.status, "HEALTHY");
  assert.deepEqual(report.notes, ["metrics-server is not installed in this cluster, so CPU and memory usage is not available."]);
});

test("pods that have no usage numbers yet are noted, not treated as zero", () => {
  const partly: AppUsage = { ...usage([podUsage("pod-a", 14, 50)]), podsWithoutMetrics: ["pod-b", "pod-c"] };

  const report = evaluateHealth(input({ usage: partly }), thresholds);

  assert.equal(report.status, "HEALTHY");
  assert.deepEqual(report.notes, ["No usage numbers yet for 2 pods (metrics-server needs a minute or two after a pod starts)."]);
});

test("the worst signal wins and every reason is listed", () => {
  const report = evaluateHealth(
    input({
      deployment: deployment({ availableReplicas: 2 }),
      probe: { ok: false, statusCode: 500, responseMs: 30 },
      usage: usage([podUsage("pod-a", 14, 91)]),
    }),
    thresholds,
  );

  assert.equal(report.status, "DOWN");
  assert.deepEqual(report.reasons, [
    "Only 2 of 3 pods are available.",
    "/health answered with status 500.",
    "pod-a uses 91% of its memory limit (threshold 85%).",
  ]);
});

// ---- Which pods count as having a problem ----

function pod(overrides: Partial<PodInfo>): PodInfo {
  return {
    name: "pod-a",
    phase: "Running",
    ready: true,
    restarts: 0,
    image: "sample-app:v2",
    createdAt: minutesAgo(120),
    containers: [],
    ...overrides,
  };
}

const namesOf = (pods: PodInfo[]): string[] => findProblemPods(pods, thresholds, NOW).map((found) => found.name);

test("a ready pod without restarts is not a problem", () => {
  assert.deepEqual(namesOf([pod({})]), []);
});

test("a pod waiting for a failure reason is a problem", () => {
  const pods = [
    pod({ name: "crashing", ready: false, waitingReason: "CrashLoopBackOff" }),
    pod({ name: "no-image", ready: false, phase: "Pending", waitingReason: "ImagePullBackOff", createdAt: minutesAgo(0.1) }),
  ];

  assert.deepEqual(namesOf(pods), ["crashing", "no-image"]);
});

test("a pod that is still starting is not a problem", () => {
  const starting = pod({ ready: false, phase: "Pending", waitingReason: "ContainerCreating", createdAt: minutesAgo(0.2) });

  assert.deepEqual(namesOf([starting]), []);
});

test("a pod Pending for longer than the threshold is a problem", () => {
  const pods = [
    pod({ name: "stuck", ready: false, phase: "Pending", createdAt: minutesAgo(2) }),
    pod({ name: "just-created", ready: false, phase: "Pending", createdAt: minutesAgo(0.5) }),
  ];

  assert.deepEqual(namesOf(pods), ["stuck"]);
});

test("a pod that restarted more often than the threshold is a problem", () => {
  const pods = [pod({ name: "flaky", restarts: 4 }), pod({ name: "restarted-once", restarts: 3 })];

  assert.deepEqual(namesOf(pods), ["flaky"]);
});

test("an OOMKill counts only while it is recent", () => {
  const pods = [
    pod({ name: "killed-recently", restarts: 1, lastTerminationReason: "OOMKilled", lastTerminatedAt: minutesAgo(5) }),
    pod({ name: "killed-long-ago", restarts: 1, lastTerminationReason: "OOMKilled", lastTerminatedAt: minutesAgo(90) }),
  ];

  assert.deepEqual(namesOf(pods), ["killed-recently"]);
});

test("a service with its own health path is named by that path in the reasons", () => {
  const noAnswer = evaluateHealth(
    input({ healthPath: "/healthz", probe: { ok: false, statusCode: null, responseMs: 3000 } }),
    thresholds,
  );
  const slow = evaluateHealth(
    input({ healthPath: "/healthz", probe: { ok: true, statusCode: 200, responseMs: 1500 } }),
    thresholds,
  );

  assert.deepEqual(noAnswer.reasons, ["/healthz did not answer within 3000 ms."]);
  assert.deepEqual(slow.reasons, ["/healthz is slow: 1500 ms (threshold 1000 ms)."]);
});
