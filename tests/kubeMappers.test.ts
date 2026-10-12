import assert from "node:assert/strict";
import { test } from "node:test";

import type { V1Deployment, V1Node, V1Pod } from "@kubernetes/client-node";

import { toDeploymentInfo, toNodeInfo, toPodInfo } from "../src/cluster/kubeMappers.ts";

const container = {
  name: "sample-app",
  image: "sample-app:v2",
  resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "256Mi" } },
};

function deployment(overrides: Partial<V1Deployment> = {}): V1Deployment {
  return {
    metadata: { name: "sample-app", namespace: "staging", generation: 3 },
    spec: { replicas: 3, selector: {}, template: { spec: { containers: [container] } } },
    status: { observedGeneration: 3, updatedReplicas: 3, readyReplicas: 2, availableReplicas: 2 },
    ...overrides,
  };
}

test("a deployment is reduced to its image and replica counts", () => {
  assert.deepEqual(toDeploymentInfo(deployment()), {
    name: "sample-app",
    namespace: "staging",
    image: "sample-app:v2",
    desiredReplicas: 3,
    updatedReplicas: 3,
    readyReplicas: 2,
    availableReplicas: 2,
    rolloutObserved: true,
  });
});

test("replica counts Kubernetes leaves out are read as zero", () => {
  const info = toDeploymentInfo(deployment({ status: { observedGeneration: 3 } }));

  assert.equal(info.readyReplicas, 0);
  assert.equal(info.availableReplicas, 0);
  assert.equal(info.updatedReplicas, 0);
});

test("a change the cluster has not looked at yet is marked as not observed", () => {
  const info = toDeploymentInfo(deployment({ status: { observedGeneration: 2 } }));

  assert.equal(info.rolloutObserved, false);
});

const createdAt = new Date("2026-10-12T10:00:00Z");

function pod(status: V1Pod["status"]): V1Pod {
  return {
    metadata: { name: "sample-app-7d9f-x2k4", creationTimestamp: createdAt },
    spec: { containers: [container] },
    status,
  };
}

test("a running, ready pod", () => {
  const info = toPodInfo(
    pod({
      phase: "Running",
      conditions: [{ type: "Ready", status: "True" }],
      containerStatuses: [
        { name: "sample-app", image: "sample-app:v2", imageID: "", ready: true, restartCount: 0, state: { running: {} } },
      ],
    }),
  );

  assert.deepEqual(info, {
    name: "sample-app-7d9f-x2k4",
    phase: "Running",
    ready: true,
    restarts: 0,
    image: "sample-app:v2",
    createdAt,
    containers: [
      { name: "sample-app", requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "256Mi" } },
    ],
  });
});

test("a crash-looping pod carries the waiting reason, restart count and last exit", () => {
  const finishedAt = new Date("2026-10-12T10:05:00Z");

  const info = toPodInfo(
    pod({
      phase: "Running",
      conditions: [{ type: "Ready", status: "False" }],
      containerStatuses: [
        {
          name: "sample-app",
          image: "sample-app:v3",
          imageID: "",
          ready: false,
          restartCount: 4,
          state: { waiting: { reason: "CrashLoopBackOff", message: "back-off 40s restarting failed container" } },
          lastState: { terminated: { reason: "Error", exitCode: 1, finishedAt } },
        },
      ],
    }),
  );

  assert.equal(info.ready, false);
  assert.equal(info.restarts, 4);
  assert.equal(info.waitingReason, "CrashLoopBackOff");
  assert.equal(info.waitingMessage, "back-off 40s restarting failed container");
  assert.equal(info.lastTerminationReason, "Error");
  assert.equal(info.lastExitCode, 1);
  assert.equal(info.lastTerminatedAt, finishedAt);
});

test("a pod whose image cannot be pulled carries the pull error", () => {
  const info = toPodInfo(
    pod({
      phase: "Pending",
      containerStatuses: [
        {
          name: "sample-app",
          image: "sample-app:v9",
          imageID: "",
          ready: false,
          restartCount: 0,
          state: { waiting: { reason: "ImagePullBackOff", message: 'Back-off pulling image "sample-app:v9"' } },
        },
      ],
    }),
  );

  assert.equal(info.phase, "Pending");
  assert.equal(info.waitingReason, "ImagePullBackOff");
  assert.equal(info.waitingMessage, 'Back-off pulling image "sample-app:v9"');
});

test("a pod killed for memory carries OOMKilled as its last termination reason", () => {
  const info = toPodInfo(
    pod({
      phase: "Running",
      conditions: [{ type: "Ready", status: "True" }],
      containerStatuses: [
        {
          name: "sample-app",
          image: "sample-app:v2",
          imageID: "",
          ready: true,
          restartCount: 2,
          state: { running: {} },
          lastState: { terminated: { reason: "OOMKilled", exitCode: 137, finishedAt: createdAt } },
        },
      ],
    }),
  );

  assert.equal(info.restarts, 2);
  assert.equal(info.lastTerminationReason, "OOMKilled");
  assert.equal(info.waitingReason, undefined);
});

test("a pod the scheduler cannot place carries the scheduler's message", () => {
  const info = toPodInfo(
    pod({
      phase: "Pending",
      conditions: [
        {
          type: "PodScheduled",
          status: "False",
          reason: "Unschedulable",
          message: "0/1 nodes are available: 1 Insufficient memory.",
        },
      ],
    }),
  );

  assert.equal(info.phase, "Pending");
  assert.equal(info.ready, false);
  assert.equal(info.unschedulableMessage, "0/1 nodes are available: 1 Insufficient memory.");
});

test("a node is reduced to Ready, pressure conditions and what it can hand out", () => {
  const node: V1Node = {
    metadata: { name: "node-1" },
    status: {
      allocatable: { cpu: "4", memory: "6052948Ki" },
      conditions: [
        { type: "MemoryPressure", status: "False" },
        { type: "DiskPressure", status: "True" },
        { type: "Ready", status: "True" },
      ],
    },
  };

  assert.deepEqual(toNodeInfo(node), {
    name: "node-1",
    ready: true,
    memoryPressure: false,
    diskPressure: true,
    allocatable: { cpu: "4", memory: "6052948Ki" },
  });
});
