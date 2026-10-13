import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatFullStatus,
  formatHealth,
  formatHelp,
  formatHistory,
  formatNodes,
  formatPlan,
  formatSuggestions,
  formatTopPod,
  formatUsage,
} from "@/agent/replyFormatter.ts";
import { parseMessage } from "@/agent/intentParser.ts";
import type { PodInfo } from "@/types/cluster.ts";
import type { ChangePlan } from "@/types/deployment.ts";
import type { DeploymentRecord } from "@/types/deployment.ts";
import type { AppUsage, PodUsageReport, ResourceUse } from "@/types/monitoring.ts";
import type { AppStatus } from "@/types/monitoring.ts";

const MI = 1024 * 1024;

function cpu(used: number): ResourceUse {
  return { used, request: 100, limit: 500, percentOfRequest: Math.round(used), percentOfLimit: Math.round(used / 5) };
}

function memory(usedMi: number): ResourceUse {
  return {
    used: usedMi * MI,
    request: 128 * MI,
    limit: 256 * MI,
    percentOfRequest: Math.round((usedMi / 128) * 100),
    percentOfLimit: Math.round((usedMi / 256) * 100),
  };
}

function podUsage(podName: string, cpuMillicores: number, memoryMi: number, extra: Partial<PodUsageReport> = {}): PodUsageReport {
  return { podName, restarts: 0, cpu: cpu(cpuMillicores), memory: memory(memoryMi), ...extra };
}

/** Three pods using 210m CPU and 380Mi in total: the numbers from the test description. */
function usage(): AppUsage {
  const pods = [podUsage("sample-app-a", 70, 127), podUsage("sample-app-b", 60, 55), podUsage("sample-app-c", 80, 198)];
  return {
    available: true,
    pods,
    podsWithoutMetrics: [],
    total: {
      cpu: { used: 210, request: 300, limit: 1500, percentOfRequest: 70, percentOfLimit: 14 },
      memory: { used: 380 * MI, request: 384 * MI, limit: 768 * MI, percentOfRequest: 99, percentOfLimit: 49 },
    },
  };
}

function pod(name: string, restarts = 0): PodInfo {
  return { name, phase: "Running", ready: true, restarts, image: "sample-app:v2", createdAt: new Date(0), containers: [] };
}

function status(overrides: Partial<AppStatus> = {}): AppStatus {
  return {
    environment: "staging",
    app: "sample-app",
    health: { status: "HEALTHY", reasons: [], notes: [] },
    deployment: {
      name: "sample-app",
      namespace: "staging",
      image: "sample-app:v2",
      desiredReplicas: 3,
      updatedReplicas: 3,
      readyReplicas: 3,
      availableReplicas: 3,
      rolloutObserved: true,
    },
    pods: [pod("sample-app-a"), pod("sample-app-b"), pod("sample-app-c")],
    probe: { ok: true, statusCode: 200, responseMs: 62 },
    usage: usage(),
    ...overrides,
  };
}

// ---- Health ----

test("a healthy app is one status line and one line of facts", () => {
  assert.equal(
    formatHealth(status()),
    "sample-app (staging) is HEALTHY\n" + "Pods 3/3 ready, 0 restarts | /health: 200 in 62 ms | Rollout: complete",
  );
});

test("an unhealthy app lists every reason and note under the facts", () => {
  const degraded = status({
    health: {
      status: "DEGRADED",
      reasons: ["Only 2 of 3 pods are available.", "sample-app-c: Pending: not enough memory on the nodes."],
      notes: ["metrics-server is not ready, so CPU and memory usage is not available right now."],
    },
    deployment: { ...status().deployment, readyReplicas: 2, availableReplicas: 2, updatedReplicas: 2 },
    pods: [pod("sample-app-a", 1), pod("sample-app-b", 2)],
    probe: { ok: false, statusCode: null, responseMs: 3000 },
  });

  assert.equal(
    formatHealth(degraded),
    [
      "sample-app (staging) is DEGRADED",
      "Pods 2/3 ready, 3 restarts | /health: no answer | Rollout: in progress (2/3 updated)",
      "- Only 2 of 3 pods are available.",
      "- sample-app-c: Pending: not enough memory on the nodes.",
      "Note: metrics-server is not ready, so CPU and memory usage is not available right now.",
    ].join("\n"),
  );
});

test("the full status adds the image and resource use against limits", () => {
  assert.equal(
    formatFullStatus(status({ environment: "prod" })),
    [
      "sample-app (prod) is HEALTHY",
      "Pods 3/3 ready, 0 restarts | /health: 200 in 62 ms | Rollout: complete",
      "Image: sample-app:v2 | CPU: 14% of limits | Memory: 49% of limits",
    ].join("\n"),
  );
});

test("the full status says resource use is unknown when metrics are missing", () => {
  const text = formatFullStatus(status({ usage: { available: false, reason: "metrics-server is not installed." } }));

  assert.ok(text.includes("Image: sample-app:v2 | CPU and memory: not available"), text);
});

// ---- CPU and memory ----

test("usage shows totals, the average per pod against the limit, and every pod", () => {
  assert.equal(
    formatUsage("staging", "sample-app", usage()),
    [
      "sample-app (staging)",
      "CPU:    total 210m, avg 70m per pod (14% of 500m limit)",
      "Memory: total 380Mi, avg 127Mi per pod (49% of 256Mi limit)",
      "Per pod:",
      "  sample-app-a: CPU 70m (14% of limit, 70% of request) | Memory 127Mi (50% of limit, 99% of request)",
      "  sample-app-b: CPU 60m (12% of limit, 60% of request) | Memory 55Mi (21% of limit, 43% of request)",
      "  sample-app-c: CPU 80m (16% of limit, 80% of request) | Memory 198Mi (77% of limit, 155% of request)",
    ].join("\n"),
  );
});

test("missing metrics are reported as missing, with no numbers at all", () => {
  const text = formatUsage("staging", "sample-app", {
    available: false,
    reason: "metrics-server is not installed in this cluster, so CPU and memory usage is not available.",
  });

  assert.equal(text, "metrics-server is not installed in this cluster, so CPU and memory usage is not available.");
  assert.doesNotMatch(text, /\d/);
});

test("pods without numbers yet are named, and no zero totals are shown for them", () => {
  const nothingYet: AppUsage = { ...usage(), pods: [], podsWithoutMetrics: ["sample-app-a", "sample-app-b"] };

  assert.equal(
    formatUsage("staging", "sample-app", nothingYet),
    "sample-app (staging)\n" +
      "No numbers yet for: sample-app-a, sample-app-b (metrics-server needs a minute or two after a pod starts).",
  );
});

test("a container without a limit says so instead of showing a percentage", () => {
  const unlimited = usage();
  const first = unlimited.pods[0];
  assert.ok(first);
  first.memory = { used: 127 * MI, request: null, limit: null, percentOfRequest: null, percentOfLimit: null };
  unlimited.total.memory = { used: 380 * MI, request: null, limit: null, percentOfRequest: null, percentOfLimit: null };

  const text = formatUsage("staging", "sample-app", unlimited);

  assert.ok(text.includes("Memory: total 380Mi, avg 127Mi per pod (no limit set)"), text);
  assert.ok(text.includes("Memory 127Mi (no limit, no request)"), text);
});

test("the pod using the most memory is named with restarts and the last reason in plain words", () => {
  const withRestarts = usage();
  const third = withRestarts.pods[2];
  assert.ok(third);
  third.restarts = 2;
  third.lastTerminationReason = "OOMKilled";

  assert.equal(
    formatTopPod(withRestarts, "memory"),
    "sample-app-c: 198Mi (77% of limit), restarted 2 times, last reason: OOMKilled (killed for using more memory than its limit)",
  );
});

test("the pod using the most CPU is named", () => {
  assert.equal(formatTopPod(usage(), "cpu"), "sample-app-c: 80m (16% of limit)");
});

// ---- Nodes ----

test("nodes show usage, Ready and any pressure", () => {
  const text = formatNodes({
    metricsUnavailableReason: null,
    nodes: [
      { name: "node-1", ready: true, memoryPressure: false, diskPressure: false, cpuPercent: 41, memoryPercent: 63 },
      { name: "node-2", ready: true, memoryPressure: true, diskPressure: true, cpuPercent: 18, memoryPercent: 35 },
      { name: "node-3", ready: false, memoryPressure: false, diskPressure: false, cpuPercent: 2, memoryPercent: 5 },
    ],
  });

  assert.equal(
    text,
    [
      "3 nodes, 1 not Ready",
      "node-1: CPU 41%, memory 63% | Ready",
      "node-2: CPU 18%, memory 35% | Ready | memory pressure | disk pressure",
      "node-3: CPU 2%, memory 5% | NOT READY",
    ].join("\n"),
  );
});

test("nodes without metrics show Ready status and say why usage is unknown", () => {
  const text = formatNodes({
    metricsUnavailableReason: "metrics-server is not installed in this cluster, so CPU and memory usage is not available.",
    nodes: [{ name: "node-1", ready: true, memoryPressure: false, diskPressure: false, cpuPercent: null, memoryPercent: null }],
  });

  assert.equal(
    text,
    "1 node, all Ready\n" +
      "node-1: usage unknown | Ready\n" +
      "Note: metrics-server is not installed in this cluster, so CPU and memory usage is not available.",
  );
});

// ---- History ----

function record(overrides: Partial<DeploymentRecord>): DeploymentRecord {
  return {
    id: 7,
    environment: "staging",
    app: "sample-app",
    action: "deploy",
    image: "sample-app:v2",
    previousImage: "sample-app:v1",
    replicas: 3,
    status: "succeeded",
    requestedBy: "asha",
    message: null,
    startedAt: new Date("2026-10-12T18:40:00Z"),
    finishedAt: new Date("2026-10-12T18:42:10Z"),
    ...overrides,
  };
}

test("the history shows one line per deployment with what changed, by whom and when", () => {
  const text = formatHistory(
    [
      record({ id: 9, action: "scale", image: "sample-app:v1", previousImage: "sample-app:v1", replicas: 5 }),
      record({ id: 8, action: "rollback", image: "sample-app:v1", previousImage: "sample-app:v2", requestedBy: "ravi" }),
      record({ id: 7 }),
      record({ id: 6, image: "sample-app:v1", previousImage: null, status: "failed" }),
    ],
    {},
  );

  assert.equal(
    text,
    [
      "Last 4 deployments:",
      "dep-009 | staging | scale sample-app:v1 to 5 replicas | succeeded | asha | 2026-10-12 18:42 UTC",
      "dep-008 | staging | rollback sample-app:v2 -> sample-app:v1 | succeeded | ravi | 2026-10-12 18:42 UTC",
      "dep-007 | staging | deploy sample-app:v1 -> sample-app:v2 | succeeded | asha | 2026-10-12 18:42 UTC",
      "dep-006 | staging | deploy sample-app:v1 (first deployment) | failed | asha | 2026-10-12 18:42 UTC",
    ].join("\n"),
  );
});

test("the history title says whose deployments and where", () => {
  assert.equal(
    formatHistory([record({})], { requestedBy: "asha", environment: "staging" }).split("\n")[0],
    "Last 1 deployment by asha in staging:",
  );
  assert.equal(formatHistory([], { requestedBy: "asha" }), "No deployments by asha recorded yet.");
});

// ---- Confirmation summaries ----

const plan: ChangePlan = {
  action: "deploy",
  environment: "staging",
  namespace: "staging",
  app: "sample-app",
  image: "sample-app:v2",
  currentImage: "sample-app:v1",
  replicas: 3,
  currentReplicas: 3,
};

test("a deploy summary names the deployment, namespace, image and replicas", () => {
  assert.equal(
    formatPlan(plan),
    'I\'ll update deployment "sample-app" in namespace "staging" to image sample-app:v2 (3 replicas). It runs sample-app:v1 now.',
  );
  assert.equal(
    formatPlan({ ...plan, currentImage: null, currentReplicas: null }),
    'I\'ll create deployment "sample-app" in namespace "staging" with image sample-app:v2 (3 replicas).',
  );
});

test("rollback and scale summaries say from what to what", () => {
  assert.equal(
    formatPlan({ ...plan, action: "rollback", image: "sample-app:v1", currentImage: "sample-app:v2" }),
    "Roll back sample-app in staging from sample-app:v2 to sample-app:v1?",
  );
  assert.equal(
    formatPlan({ ...plan, action: "scale", image: "sample-app:v1", replicas: 5 }),
    "Scale sample-app in staging from 3 to 5 replicas?",
  );
});

// ---- Help ----

test("help lists an example for each thing the agent can do, with the known names", () => {
  const text = formatHelp({ environments: ["staging", "prod"], apps: ["sample-app"] });

  for (const example of ["deploy sample-app version v2 to staging", "roll back staging", "scale staging to 5 replicas", "is staging healthy?", "how are the nodes doing?", "full status of prod", "show my last 5 deployments"]) {
    assert.ok(text.includes(example), `help should mention: ${example}`);
  }
  assert.ok(text.includes("Environments: staging, prod"), text);
});

test("help ends with how messages are read, when that is given", () => {
  const text = formatHelp({ environments: ["staging", "prod"], apps: ["sample-app"] }, "Messages are read by built-in rules.");

  assert.equal(text.split("\n").at(-1), "Messages are read by built-in rules.");
});

// ---- Requests to try ----

test("the requests to try use the first environment and the first app", () => {
  assert.deepEqual(formatSuggestions({ environments: ["staging", "prod"], apps: ["sample-app"] }), [
    "is staging healthy?",
    "deploy sample-app version v2 to staging",
    "show my last 5 deployments",
    "what can you do?",
  ]);
});

test("every request to try is one the built-in rules understand", () => {
  const known = { environments: ["staging", "prod"], apps: ["sample-app"] };

  for (const example of formatSuggestions(known)) {
    assert.notEqual(parseMessage(example, known).intent, null, example);
  }
});
