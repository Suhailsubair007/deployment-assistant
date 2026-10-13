import type {
  CoreV1Event,
  NodeMetric,
  PodMetric,
  V1Container,
  V1Deployment,
  V1Node,
  V1Pod,
} from "@kubernetes/client-node";

import type {
  ContainerResources,
  DeploymentInfo,
  EventInfo,
  NodeInfo,
  NodeUsage,
  PodInfo,
  PodUsage,
  ResourceQuantities,
} from "@/types/cluster.ts";

export function toDeploymentInfo(deployment: V1Deployment): DeploymentInfo {
  const generation = deployment.metadata?.generation ?? 0;
  const observedGeneration = deployment.status?.observedGeneration ?? 0;

  return {
    name: deployment.metadata?.name ?? "",
    namespace: deployment.metadata?.namespace ?? "",
    image: deployment.spec?.template.spec?.containers[0]?.image ?? "",
    desiredReplicas: deployment.spec?.replicas ?? 0,
    updatedReplicas: deployment.status?.updatedReplicas ?? 0,
    readyReplicas: deployment.status?.readyReplicas ?? 0,
    availableReplicas: deployment.status?.availableReplicas ?? 0,
    rolloutObserved: observedGeneration >= generation,
  };
}

function toQuantities(amounts: { [resource: string]: string } | undefined): ResourceQuantities {
  const quantities: ResourceQuantities = {};
  if (amounts?.cpu) {
    quantities.cpu = amounts.cpu;
  }
  if (amounts?.memory) {
    quantities.memory = amounts.memory;
  }
  return quantities;
}

function toContainerResources(container: V1Container): ContainerResources {
  return {
    name: container.name,
    requests: toQuantities(container.resources?.requests),
    limits: toQuantities(container.resources?.limits),
  };
}

export function toPodInfo(pod: V1Pod): PodInfo {
  const containerStatuses = pod.status?.containerStatuses ?? [];
  const conditions = pod.status?.conditions ?? [];

  const info: PodInfo = {
    name: pod.metadata?.name ?? "",
    phase: pod.status?.phase ?? "Unknown",
    ready: conditions.some((condition) => condition.type === "Ready" && condition.status === "True"),
    restarts: containerStatuses.reduce((total, status) => total + status.restartCount, 0),
    image: pod.spec?.containers[0]?.image ?? "",
    createdAt: pod.metadata?.creationTimestamp ?? new Date(0),
    containers: (pod.spec?.containers ?? []).map(toContainerResources),
  };

  // A container that is not running is "waiting", with a reason such as CrashLoopBackOff.
  const waiting = containerStatuses.map((status) => status.state?.waiting).find((state) => state !== undefined);
  if (waiting?.reason) {
    info.waitingReason = waiting.reason;
  }
  if (waiting?.message) {
    info.waitingMessage = waiting.message;
  }

  // How the container ended last time: before its last restart, or right now if it is stopped.
  const terminated = containerStatuses
    .map((status) => status.lastState?.terminated ?? status.state?.terminated)
    .find((state) => state !== undefined);
  if (terminated) {
    info.lastExitCode = terminated.exitCode;
    if (terminated.reason) {
      info.lastTerminationReason = terminated.reason;
    }
    if (terminated.finishedAt) {
      info.lastTerminatedAt = terminated.finishedAt;
    }
  }

  // A pod that fits on no node stays Pending; the scheduler explains why in this condition.
  const notScheduled = conditions.find(
    (condition) => condition.type === "PodScheduled" && condition.status === "False",
  );
  if (notScheduled?.message) {
    info.unschedulableMessage = notScheduled.message;
  }

  return info;
}

export function toEventInfo(event: CoreV1Event): EventInfo {
  return {
    type: event.type ?? "Normal",
    reason: event.reason ?? "",
    message: event.message ?? "",
    at: event.lastTimestamp ?? event.eventTime ?? event.metadata.creationTimestamp ?? null,
  };
}

export function toNodeInfo(node: V1Node): NodeInfo {
  const conditions = node.status?.conditions ?? [];
  const isTrue = (type: string): boolean =>
    conditions.some((condition) => condition.type === type && condition.status === "True");

  return {
    name: node.metadata?.name ?? "",
    ready: isTrue("Ready"),
    memoryPressure: isTrue("MemoryPressure"),
    diskPressure: isTrue("DiskPressure"),
    allocatable: {
      cpu: node.status?.allocatable?.cpu ?? "0",
      memory: node.status?.allocatable?.memory ?? "0",
    },
  };
}

export function toPodUsage(metric: PodMetric): PodUsage {
  return {
    podName: metric.metadata.name,
    containers: metric.containers.map((container) => ({
      name: container.name,
      cpu: container.usage.cpu,
      memory: container.usage.memory,
    })),
  };
}

export function toNodeUsage(metric: NodeMetric): NodeUsage {
  return { nodeName: metric.metadata.name, cpu: metric.usage.cpu, memory: metric.usage.memory };
}
