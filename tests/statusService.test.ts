import assert from "node:assert/strict";
import { test } from "node:test";

import { loadConfig } from "../src/config.ts";
import { ClusterUnreachableError, InvalidRequestError, MetricsUnavailableError, NotFoundError } from "../src/errors.ts";
import { FailureExplainer } from "../src/services/failureExplainer.ts";
import { HistoryStore } from "../src/services/historyStore.ts";
import { MetricsService } from "../src/services/metricsService.ts";
import { StatusService } from "../src/services/statusService.ts";
import { FakeGateway } from "./helpers/fakeGateway.ts";

const NOW = new Date("2026-10-12T12:00:00Z");

/** sample-app v2 runs in staging with 3 healthy pods using little CPU and memory. Prod is empty. */
async function setup() {
  const gateway = new FakeGateway();
  gateway.rollout = "frozen";
  gateway.seed("staging", "sample-app", "sample-app:v2", 3);
  const podNames = (await gateway.listPods("staging", "sample-app")).map((pod) => pod.name);
  for (const name of podNames) {
    gateway.podUsage.set(name, { cpu: "70m", memory: "127Mi" });
  }
  const config = loadConfig("config/app.config.yaml");
  const history = new HistoryStore(":memory:");
  const service = new StatusService({
    gateway,
    history,
    config,
    metrics: new MetricsService(gateway),
    explainer: new FailureExplainer(gateway),
    now: () => NOW,
  });
  return { gateway, history, config, service, podNames };
}

test("a healthy app is reported HEALTHY together with the facts behind it", async () => {
  const { service } = await setup();

  const status = await service.getStatus("staging", "sample-app");

  assert.deepEqual(status?.health, { status: "HEALTHY", reasons: [], notes: [] });
  assert.equal(status?.deployment.image, "sample-app:v2");
  assert.equal(status?.deployment.availableReplicas, 3);
  assert.equal(status?.probe.responseMs, 62);
  assert.equal(status?.usage.available, true);
  assert.equal(status?.pods.length, 3);
});

test("an app that is not deployed gives null", async () => {
  const { service } = await setup();

  assert.equal(await service.getStatus("prod", "sample-app"), null);
});

test("an unknown environment is refused", async () => {
  const { service } = await setup();

  await assert.rejects(
    service.getStatus("qa", "sample-app"),
    new InvalidRequestError('There is no environment called "qa". I know: staging, prod.'),
  );
});

test("a namespace missing from the cluster is reported as such", async () => {
  const { service, gateway } = await setup();
  gateway.namespaces.delete("prod");

  await assert.rejects(
    service.getStatus("prod", "sample-app"),
    new NotFoundError('Namespace "prod" does not exist in this cluster.', "namespaces"),
  );
});

test("a crashing pod makes the app DEGRADED and is explained with its last log line", async () => {
  const { service, gateway, podNames } = await setup();
  const crashing = gateway.podOf("staging", "sample-app", {
    name: "sample-app-crashing",
    ready: false,
    restarts: 4,
    waitingReason: "CrashLoopBackOff",
    lastExitCode: 1,
  });
  const healthy = (await gateway.listPods("staging", "sample-app")).filter((pod) => pod.name !== podNames[2]);
  gateway.setPods("staging", "sample-app", [...healthy, crashing]);
  gateway.logs.set("sample-app-crashing", ["starting", "Fatal: cannot read /etc/app/config.json"]);

  const status = await service.getStatus("staging", "sample-app");

  assert.equal(status?.health.status, "DEGRADED");
  assert.deepEqual(status?.health.reasons, [
    "Only 2 of 3 pods are available.",
    'sample-app-crashing: Container keeps crashing (4 restarts, exit code 1). Last log line: "Fatal: cannot read /etc/app/config.json".',
  ]);
});

test("a pod stuck in Pending without a stated reason still gets an explanation", async () => {
  const { service, gateway } = await setup();
  const healthy = await gateway.listPods("staging", "sample-app");
  const stuck = gateway.podOf("staging", "sample-app", {
    name: "sample-app-stuck",
    phase: "Pending",
    ready: false,
    createdAt: new Date(NOW.getTime() - 95_000),
  });
  gateway.setPods("staging", "sample-app", [...healthy, stuck]);

  const status = await service.getStatus("staging", "sample-app");

  assert.deepEqual(status?.health.reasons, ["sample-app-stuck: Pending for 95 seconds."]);
});

test("memory above the threshold makes the app DEGRADED with the pod and the numbers", async () => {
  const { service, gateway, podNames } = await setup();
  gateway.podUsage.set(podNames[0] ?? "", { cpu: "70m", memory: "240Mi" });

  const status = await service.getStatus("staging", "sample-app");

  assert.equal(status?.health.status, "DEGRADED");
  assert.deepEqual(status?.health.reasons, [`${podNames[0]} uses 94% of its memory limit (threshold 85%).`]);
});

test("a per-environment threshold from the config file is applied to that environment only", async () => {
  const { service, gateway, config } = await setup();
  config.thresholds.overrides.prod = { memoryPercentOfLimit: 40 };
  gateway.seed("prod", "sample-app", "sample-app:v2", 1);
  const [prodPod] = await gateway.listPods("prod", "sample-app");
  gateway.podUsage.set(prodPod?.name ?? "", { cpu: "70m", memory: "127Mi" }); // 50% of the limit

  assert.equal((await service.getStatus("staging", "sample-app"))?.health.status, "HEALTHY");
  assert.equal((await service.getStatus("prod", "sample-app"))?.health.status, "DEGRADED");
});

test("without metrics-server the status comes from the other signals and says what was not checked", async () => {
  const { service, gateway } = await setup();
  gateway.metricsError = new MetricsUnavailableError("metrics-server is not installed in this cluster, so CPU and memory usage is not available.");

  const status = await service.getStatus("staging", "sample-app");

  assert.equal(status?.health.status, "HEALTHY");
  assert.deepEqual(status?.health.notes, [
    "metrics-server is not installed in this cluster, so CPU and memory usage is not available.",
  ]);
});

test("a failing /health makes the app DOWN", async () => {
  const { service, gateway } = await setup();
  gateway.health = { ok: false, statusCode: 503, responseMs: 5 };

  const status = await service.getStatus("staging", "sample-app");

  assert.equal(status?.health.status, "DOWN");
  assert.deepEqual(status?.health.reasons, ["/health answered with status 503."]);
});

// ---- The status panel ----

test("the panel lists every environment with status, image and last update", async () => {
  const { service, history } = await setup();
  const record = history.start({
    environment: "staging",
    app: "sample-app",
    action: "deploy",
    image: "sample-app:v2",
    previousImage: "sample-app:v1",
    replicas: 3,
    requestedBy: "asha",
  });
  history.finish(record.id, "succeeded");

  const summaries = await service.getSummaries();

  assert.equal(summaries.length, 2);
  assert.equal(summaries[0]?.environment, "staging");
  assert.equal(summaries[0]?.status, "HEALTHY");
  assert.equal(summaries[0]?.reason, "");
  assert.equal(summaries[0]?.image, "sample-app:v2");
  assert.ok(summaries[0]?.lastUpdate instanceof Date);
  assert.deepEqual(summaries[1], {
    environment: "prod",
    app: "sample-app",
    status: "NOT DEPLOYED",
    reason: "sample-app is not deployed in prod yet.",
    image: null,
    lastUpdate: null,
  });
});

test("the panel shows the first reason when an environment is not healthy", async () => {
  const { service, gateway } = await setup();
  gateway.health = { ok: false, statusCode: null, responseMs: 3000 };

  const [staging] = await service.getSummaries();

  assert.equal(staging?.status, "DOWN");
  assert.equal(staging?.reason, "/health did not answer within 3000 ms.");
});

test("an environment that cannot be checked is UNKNOWN; the others are still shown", async () => {
  const { service, gateway } = await setup();
  gateway.failNext("getDeployment", new ClusterUnreachableError("I can't reach the cluster."));

  const [staging, prod] = await service.getSummaries();

  assert.equal(staging?.status, "UNKNOWN");
  assert.equal(staging?.reason, "I can't reach the cluster.");
  assert.equal(prod?.status, "NOT DEPLOYED");
});
