import { TERMINATION_MEANINGS } from "@/constants/agent.ts";
import { formatDeploymentId } from "@/services/historyStore.ts";
import { formatCpu, formatMemory } from "@/services/units.ts";
import type { KnownNames } from "@/types/agent.ts";
import type { ChangePlan, DeploymentRecord } from "@/types/deployment.ts";
import type { ServiceSpec } from "@/types/service.ts";
import type {
  AppStatus,
  AppUsage,
  MetricsUnavailable,
  NodesReport,
  PodUsageReport,
  ResourceUse,
} from "@/types/monitoring.ts";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// ---- Health ----

/** "Pods 3/3 ready, 0 restarts | /health: 200 in 62 ms | Rollout: complete" */
function factsLine(status: AppStatus): string {
  const { deployment, pods, probe } = status;
  const restarts = pods.reduce((total, pod) => total + pod.restarts, 0);

  let health: string;
  if (probe.ok) {
    health = `${probe.statusCode} in ${probe.responseMs} ms`;
  } else {
    health = probe.statusCode === null ? "no answer" : String(probe.statusCode);
  }

  const wanted = deployment.desiredReplicas;
  const rolledOut = deployment.updatedReplicas === wanted && deployment.availableReplicas === wanted;
  const rollout = rolledOut ? "complete" : `in progress (${deployment.updatedReplicas}/${wanted} updated)`;

  const path = status.healthPath ?? "/health";
  return `Pods ${deployment.readyReplicas}/${wanted} ready, ${plural(restarts, "restart")} | ${path}: ${health} | Rollout: ${rollout}`;
}

function reasonLines(status: AppStatus): string[] {
  return [
    ...status.health.reasons.map((reason) => `- ${reason}`),
    ...status.health.notes.map((note) => `Note: ${note}`),
  ];
}

export function formatHealth(status: AppStatus): string {
  return [
    `${status.app} (${status.environment}) is ${status.health.status}`,
    factsLine(status),
    ...reasonLines(status),
  ].join("\n");
}

export function formatFullStatus(status: AppStatus): string {
  let resources: string;
  if (status.usage.available) {
    const { cpu, memory } = status.usage.total;
    const share = (use: ResourceUse): string => (use.percentOfLimit === null ? "no limit set" : `${use.percentOfLimit}% of limits`);
    resources = `CPU: ${share(cpu)} | Memory: ${share(memory)}`;
  } else {
    resources = "CPU and memory: not available";
  }
  return [
    `${status.app} (${status.environment}) is ${status.health.status}`,
    factsLine(status),
    `Image: ${status.deployment.image} | ${resources}`,
    ...reasonLines(status),
  ].join("\n");
}

// ---- CPU and memory ----

function noNumbersYet(podNames: string[]): string {
  return `No numbers yet for: ${podNames.join(", ")} (metrics-server needs a minute or two after a pod starts).`;
}

/** "(14% of limit, 70% of request)" */
function shares(use: ResourceUse): string {
  const ofLimit = use.percentOfLimit === null ? "no limit" : `${use.percentOfLimit}% of limit`;
  const ofRequest = use.percentOfRequest === null ? "no request" : `${use.percentOfRequest}% of request`;
  return `(${ofLimit}, ${ofRequest})`;
}

/** "total 210m, avg 70m per pod (14% of 500m limit)" */
function totalLine(total: ResourceUse, podCount: number, format: (amount: number) => string): string {
  const limit = total.limit === null ? "no limit set" : `${total.percentOfLimit}% of ${format(total.limit / podCount)} limit`;
  return `total ${format(total.used)}, avg ${format(total.used / podCount)} per pod (${limit})`;
}

export function formatUsage(environment: string, app: string, usage: AppUsage | MetricsUnavailable): string {
  if (!usage.available) {
    return usage.reason;
  }
  const lines = [`${app} (${environment})`];
  if (usage.pods.length === 0) {
    lines.push(usage.podsWithoutMetrics.length > 0 ? noNumbersYet(usage.podsWithoutMetrics) : "No pods are running.");
    return lines.join("\n");
  }

  const podCount = usage.pods.length;
  lines.push(`CPU:    ${totalLine(usage.total.cpu, podCount, formatCpu)}`);
  lines.push(`Memory: ${totalLine(usage.total.memory, podCount, formatMemory)}`);
  lines.push("Per pod:");
  for (const pod of usage.pods) {
    lines.push(
      `  ${pod.podName}: CPU ${formatCpu(pod.cpu.used)} ${shares(pod.cpu)} | ` +
        `Memory ${formatMemory(pod.memory.used)} ${shares(pod.memory)}`,
    );
  }
  if (usage.podsWithoutMetrics.length > 0) {
    lines.push(noNumbersYet(usage.podsWithoutMetrics));
  }
  return lines.join("\n");
}

/** "sample-app-x2k4: 198Mi (77% of limit), restarted 2 times, last reason: OOMKilled (...)" */
export function formatTopPod(usage: AppUsage | MetricsUnavailable, by: "cpu" | "memory"): string {
  if (!usage.available) {
    return usage.reason;
  }
  let top: PodUsageReport | undefined;
  for (const pod of usage.pods) {
    if (top === undefined || pod[by].used > top[by].used) {
      top = pod;
    }
  }
  if (top === undefined) {
    return usage.podsWithoutMetrics.length > 0 ? noNumbersYet(usage.podsWithoutMetrics) : "No pods are running.";
  }

  const use = top[by];
  const amount = by === "cpu" ? formatCpu(use.used) : formatMemory(use.used);
  const share = use.percentOfLimit === null ? "no limit set" : `${use.percentOfLimit}% of limit`;
  let text = `${top.podName}: ${amount} (${share})`;
  if (top.restarts > 0) {
    text += `, restarted ${plural(top.restarts, "time")}`;
  }
  if (top.lastTerminationReason !== undefined) {
    const meaning = TERMINATION_MEANINGS[top.lastTerminationReason];
    text += `, last reason: ${top.lastTerminationReason}${meaning === undefined ? "" : ` (${meaning})`}`;
  }
  return text;
}

// ---- Nodes ----

export function formatNodes(report: NodesReport): string {
  const notReady = report.nodes.filter((node) => !node.ready).length;
  const lines = [`${plural(report.nodes.length, "node")}, ${notReady === 0 ? "all Ready" : `${notReady} not Ready`}`];

  for (const node of report.nodes) {
    const usage =
      node.cpuPercent === null || node.memoryPercent === null
        ? "usage unknown"
        : `CPU ${node.cpuPercent}%, memory ${node.memoryPercent}%`;
    const parts = [`${node.name}: ${usage}`, node.ready ? "Ready" : "NOT READY"];
    if (node.memoryPressure) {
      parts.push("memory pressure");
    }
    if (node.diskPressure) {
      parts.push("disk pressure");
    }
    lines.push(parts.join(" | "));
  }
  if (report.metricsUnavailableReason !== null) {
    lines.push(`Note: ${report.metricsUnavailableReason}`);
  }
  return lines.join("\n");
}

// ---- History ----

/** "2026-10-12 18:42 UTC" */
function formatTime(time: Date): string {
  return `${time.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function describeChange(record: DeploymentRecord): string {
  if (record.action === "scale") {
    return `scale ${record.image} to ${plural(record.replicas, "replica")}`;
  }
  if (record.action === "configure") {
    return `change settings of ${record.image}`;
  }
  if (record.previousImage === null) {
    return `${record.action} ${record.image} (first deployment)`;
  }
  return `${record.action} ${record.previousImage} -> ${record.image}`;
}

export function formatHistory(
  records: DeploymentRecord[],
  filter: { requestedBy?: string; environment?: string },
): string {
  const who = filter.requestedBy === undefined ? "" : ` by ${filter.requestedBy}`;
  const where = filter.environment === undefined ? "" : ` in ${filter.environment}`;
  if (records.length === 0) {
    return `No deployments${who}${where} recorded yet.`;
  }
  const lines = [`Last ${plural(records.length, "deployment")}${who}${where}:`];
  for (const record of records) {
    lines.push(
      [
        formatDeploymentId(record.id),
        record.environment,
        describeChange(record),
        record.status.replace("_", " "),
        record.requestedBy,
        formatTime(record.finishedAt ?? record.startedAt),
      ].join(" | "),
    );
  }
  return lines.join("\n");
}

// ---- Confirmation ----

/** "100m to 500m": the reserved amount and the most a pod may use. One amount when they are the same. */
function range(reserved: string, most: string): string {
  return reserved === most ? reserved : `${reserved} to ${most}`;
}

/** A service's settings as [name, value] pairs, in the order the summary shows them. */
function settingRows(spec: ServiceSpec): [string, string][] {
  const { requests, limits } = spec.resources;
  return [
    ["Port", String(spec.port)],
    ["Health check", spec.healthPath],
    ["CPU", range(requests.cpu, limits.cpu)],
    ["Memory", range(requests.memory, limits.memory)],
    ["Replicas", `${spec.replicas} (at most ${spec.maxReplicas})`],
    ["Variables", spec.env.length === 0 ? "none" : spec.env.map(({ name, value }) => `${name}=${value}`).join(", ")],
  ];
}

/** A headline, then one "name | value" row per setting. The page draws such rows as a table. */
function formatCreatePlan(plan: ChangePlan, spec: ServiceSpec): string {
  return [
    `Create ${plan.app} in ${plan.environment}?`,
    `Folder | ${plan.buildFrom}`,
    `Image | ${plan.image}`,
    ...settingRows(spec).map(([name, value]) => `${name} | ${value}`),
    "Note: I will build the image from the folder, hand it to the cluster and start the pods. This can take a few minutes.",
  ].join("\n");
}

/** Only the settings that differ, each as "name | old -> new". */
function formatConfigurePlan(plan: ChangePlan, spec: ServiceSpec, previous: ServiceSpec): string {
  const before = new Map(settingRows(previous));
  const changes = settingRows(spec)
    .filter(([name, value]) => before.get(name) !== value)
    .map(([name, value]) => `${name} | ${before.get(name)} -> ${value}`);
  return [
    `Change the settings of ${plan.app} in ${plan.environment}?`,
    ...changes,
    `Note: The pods are replaced one at a time with the new settings. The image stays ${plan.image}.`,
  ].join("\n");
}

/** The sentence shown above the Confirm and Cancel buttons. */
export function formatPlan(plan: ChangePlan): string {
  if (plan.action === "create" && plan.spec !== undefined) {
    return formatCreatePlan(plan, plan.spec);
  }
  if (plan.action === "configure" && plan.spec !== undefined && plan.previousSpec !== undefined) {
    return formatConfigurePlan(plan, plan.spec, plan.previousSpec);
  }
  if (plan.action === "rollback") {
    return `Roll back ${plan.app} in ${plan.environment} from ${plan.currentImage} to ${plan.image}?`;
  }
  if (plan.action === "scale") {
    return `Scale ${plan.app} in ${plan.environment} from ${plan.currentReplicas} to ${plural(plan.replicas, "replica")}?`;
  }
  const size = `(${plural(plan.replicas, "replica")})`;
  if (plan.buildFrom !== undefined) {
    const now = plan.currentImage === null ? "It is not running there yet." : `It runs ${plan.currentImage} now.`;
    return `Build ${plan.app} from ${plan.buildFrom} and deploy it to ${plan.environment} as ${plan.image} ${size}? ${now}`;
  }
  if (plan.currentImage === null) {
    return `I'll create deployment "${plan.app}" in namespace "${plan.namespace}" with image ${plan.image} ${size}.`;
  }
  return `I'll update deployment "${plan.app}" in namespace "${plan.namespace}" to image ${plan.image} ${size}. It runs ${plan.currentImage} now.`;
}

/** The extra line shown for a protected environment such as prod. */
export function formatProtectedWarning(environment: string): string {
  return `Warning: ${environment} is a protected environment. This change affects real users. Check the details before you confirm.`;
}

// ---- Help ----

/** @param howRead how messages are read (rules or OpenAI); added as the last line when given */
export function formatHelp(known: KnownNames, howRead?: string): string {
  const app = known.apps[0] ?? "my-app";
  const first = known.environments[0] ?? "staging";
  const last = known.environments.at(-1) ?? first;
  return [
    "Here is what I can do. Anything that changes the cluster asks for confirmation first.",
    "- create a service (I ask for the project folder, CPU, memory and the rest, one question at a time)",
    `- edit ${app} in ${first}`,
    `- deploy ${app} version v2 to ${first}`,
    `- roll back ${first}`,
    `- scale ${first} to 5 replicas`,
    `- is ${first} healthy?`,
    `- how much cpu and ram is ${first} using?`,
    `- which pod is using the most memory in ${first}?`,
    "- how are the nodes doing?",
    `- full status of ${last}`,
    "- show my last 5 deployments",
    `Environments: ${known.environments.join(", ")}. Apps: ${known.apps.join(", ")}.`,
    ...(howRead === undefined ? [] : [howRead]),
  ].join("\n");
}

// ---- Requests to try ----

/**
 * A few requests offered when a message was not understood. Each one is a message
 * the user could have typed; the last one asks for the full list.
 */
export function formatSuggestions(known: KnownNames): string[] {
  const app = known.apps[0] ?? "my-app";
  const first = known.environments[0] ?? "staging";
  return [
    "create a service",
    `is ${first} healthy?`,
    `deploy ${app} version v2 to ${first}`,
    "show my last 5 deployments",
    "what can you do?",
  ];
}
