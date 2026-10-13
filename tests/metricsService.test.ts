import assert from "node:assert/strict";
import { test } from "node:test";

import { ClusterUnreachableError, MetricsUnavailableError } from "@/errors.ts";
import { MetricsService } from "@/services/metricsService.ts";
import type { AppUsage } from "@/types/monitoring.ts";
import { FakeGateway } from "./helpers/fakeGateway.ts";

const MI = 1024 * 1024;

/** A cluster running sample-app in staging with the given usage per pod (limits: 500m CPU, 256Mi). */
async function setup(usage: { cpu: string; memory: string }[]) {
  const gateway = new FakeGateway();
  gateway.seed("staging", "sample-app", "sample-app:v2", usage.length);
  const pods = await gateway.listPods("staging", "sample-app");
  pods.forEach((pod, index) => {
    const used = usage[index];
    if (used !== undefined) {
      gateway.podUsage.set(pod.name, used);
    }
  });
  return { gateway, service: new MetricsService(gateway), podNames: pods.map((pod) => pod.name) };
}

/** Fails the test when metrics were reported as unavailable. */
function available(result: Awaited<ReturnType<MetricsService["getAppUsage"]>>): AppUsage {
  assert.equal(result.available, true);
  return result as AppUsage;
}

test("each pod's usage is compared with its requests and limits", async () => {
  const { service, podNames } = await setup([{ cpu: "70m", memory: "127Mi" }]);

  const usage = available(await service.getAppUsage("staging", "sample-app"));

  assert.deepEqual(usage.pods, [
    {
      podName: podNames[0],
      restarts: 0,
      cpu: { used: 70, request: 100, limit: 500, percentOfRequest: 70, percentOfLimit: 14 },
      memory: {
        used: 127 * MI,
        request: 128 * MI,
        limit: 256 * MI,
        percentOfRequest: 99,
        percentOfLimit: 50,
      },
    },
  ]);
});

test("totals add up usage, requests and limits over all pods", async () => {
  const { service } = await setup([
    { cpu: "70m", memory: "127Mi" },
    { cpu: "60m", memory: "55Mi" },
    { cpu: "80m", memory: "198Mi" },
  ]);

  const { total } = available(await service.getAppUsage("staging", "sample-app"));

  assert.deepEqual(total.cpu, { used: 210, request: 300, limit: 1500, percentOfRequest: 70, percentOfLimit: 14 });
  assert.equal(total.memory.used, 380 * MI);
  assert.equal(total.memory.percentOfLimit, 49);
});

test("usage in the units the metrics API really uses is converted", async () => {
  const { service } = await setup([{ cpu: "295861n", memory: "11676Ki" }]);

  const [pod] = available(await service.getAppUsage("staging", "sample-app")).pods;

  assert.equal(pod?.cpu.used, 0.295861);
  assert.equal(pod?.memory.used, 11676 * 1024);
});

test("a pod that has no metrics yet is listed by name instead of being shown as zero", async () => {
  const { service, gateway, podNames } = await setup([{ cpu: "70m", memory: "127Mi" }, { cpu: "70m", memory: "127Mi" }]);
  gateway.podUsage.delete(podNames[1] ?? "");

  const usage = available(await service.getAppUsage("staging", "sample-app"));

  assert.equal(usage.pods.length, 1);
  assert.deepEqual(usage.podsWithoutMetrics, [podNames[1]]);
  assert.equal(usage.total.cpu.used, 70);
});

test("a container without a limit gets no percentage of limit", async () => {
  const { service, gateway, podNames } = await setup([{ cpu: "70m", memory: "127Mi" }]);
  const unlimited = gateway.podOf("staging", "sample-app", {
    name: podNames[0],
    containers: [{ name: "sample-app", requests: { cpu: "100m", memory: "128Mi" }, limits: {} }],
  });
  gateway.setPods("staging", "sample-app", [unlimited]);

  const [pod] = available(await service.getAppUsage("staging", "sample-app")).pods;

  assert.equal(pod?.memory.limit, null);
  assert.equal(pod?.memory.percentOfLimit, null);
  assert.equal(pod?.memory.percentOfRequest, 99);
});

test("restart count and last termination reason travel with the pod's usage", async () => {
  const { service, gateway, podNames } = await setup([{ cpu: "70m", memory: "198Mi" }]);
  gateway.setPods("staging", "sample-app", [
    gateway.podOf("staging", "sample-app", { name: podNames[0], restarts: 2, lastTerminationReason: "OOMKilled" }),
  ]);

  const [pod] = available(await service.getAppUsage("staging", "sample-app")).pods;

  assert.equal(pod?.restarts, 2);
  assert.equal(pod?.lastTerminationReason, "OOMKilled");
  assert.equal(pod?.memory.percentOfLimit, 77);
});

test("when metrics-server is missing the result says so and carries no numbers", async () => {
  const { service, gateway } = await setup([{ cpu: "70m", memory: "127Mi" }]);
  gateway.metricsError = new MetricsUnavailableError("metrics-server is not installed in this cluster, so CPU and memory usage is not available.");

  assert.deepEqual(await service.getAppUsage("staging", "sample-app"), {
    available: false,
    reason: "metrics-server is not installed in this cluster, so CPU and memory usage is not available.",
  });
});

test("an unreachable cluster is not mistaken for missing metrics", async () => {
  const { service, gateway } = await setup([{ cpu: "70m", memory: "127Mi" }]);
  const unreachable = new ClusterUnreachableError("I can't reach the cluster.");
  gateway.failNext("listPods", unreachable);

  await assert.rejects(service.getAppUsage("staging", "sample-app"), unreachable);
});

test("node usage is a percentage of what the node can hand out", async () => {
  const { service } = await setup([]);

  assert.deepEqual(await service.getNodes(), {
    metricsUnavailableReason: null,
    nodes: [
      { name: "node-1", ready: true, memoryPressure: false, diskPressure: false, cpuPercent: 41, memoryPercent: 63 },
    ],
  });
});

test("nodes are still listed with Ready and pressure when metrics are missing", async () => {
  const { service, gateway } = await setup([]);
  gateway.metricsError = new MetricsUnavailableError("metrics-server is not ready, so CPU and memory usage is not available right now.");
  gateway.nodes = [{ name: "node-1", ready: false, memoryPressure: true, diskPressure: false, allocatable: { cpu: "4", memory: "8Gi" } }];

  assert.deepEqual(await service.getNodes(), {
    metricsUnavailableReason: "metrics-server is not ready, so CPU and memory usage is not available right now.",
    nodes: [
      { name: "node-1", ready: false, memoryPressure: true, diskPressure: false, cpuPercent: null, memoryPercent: null },
    ],
  });
});
