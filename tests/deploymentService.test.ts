import assert from "node:assert/strict";
import { test } from "node:test";

import { loadConfig } from "@/config.ts";
import {
  ClusterUnreachableError,
  CommandFailedError,
  DeployInProgressError,
  ForbiddenError,
  InvalidRequestError,
  NotFoundError,
} from "@/errors.ts";
import { DeploymentService } from "@/services/deploymentService.ts";
import { FailureExplainer } from "@/services/failureExplainer.ts";
import { HistoryStore } from "@/services/historyStore.ts";
import { OperationStore } from "@/services/operationStore.ts";
import { ServiceRegistry } from "@/services/serviceRegistry.ts";
import type { BuildTools } from "@/types/build.ts";
import type { ServiceSpec } from "@/types/service.ts";
import { FakeBuildTools } from "./helpers/fakeBuildTools.ts";
import { FakeGateway } from "./helpers/fakeGateway.ts";

const STAGING = { environment: "staging", app: "sample-app" };

/**
 * A service wired to a pretend cluster. Waiting is replaced by a clock the test
 * controls, so a "180 second" rollout finishes at once.
 */
function setup(options: { imageRegistry?: string; build?: BuildTools; sleep?: (ms: number) => Promise<void> } = {}) {
  const gateway = new FakeGateway();
  const history = new HistoryStore(":memory:", "fake-cluster");
  const operations = new OperationStore();
  const config = loadConfig("config/app.config.yaml");
  const registry = new ServiceRegistry({ path: ":memory:", cluster: "fake-cluster", config });
  let clockMs = 0;
  const service = new DeploymentService({
    gateway,
    history,
    operations,
    config,
    registry,
    explainer: new FailureExplainer(gateway),
    imageRegistry: options.imageRegistry,
    build: options.build,
    sleep:
      options.sleep ??
      (async (ms) => {
        clockMs += ms;
      }),
    now: () => clockMs,
  });
  return { gateway, history, operations, registry, service, elapsedMs: () => clockMs };
}

// ---- Planning: what would change. Nothing is touched yet. ----

test("a first deploy plans a new deployment with the default number of replicas", async () => {
  const { service, gateway } = setup();

  const plan = await service.planDeploy({ ...STAGING, version: "v1" });

  assert.deepEqual(plan, {
    action: "deploy",
    environment: "staging",
    namespace: "staging",
    app: "sample-app",
    image: "sample-app:v1",
    currentImage: null,
    replicas: 3,
    currentReplicas: null,
  });
  assert.deepEqual(gateway.writes, []);
});

test("a deploy keeps the replica count the app already runs with", async () => {
  const { service, gateway } = setup();
  gateway.seed("staging", "sample-app", "sample-app:v1", 5);

  const plan = await service.planDeploy({ ...STAGING, version: "v2" });

  assert.equal(plan.replicas, 5);
  assert.equal(plan.currentImage, "sample-app:v1");
});

test("the image registry from the settings is put in front of the image name", async () => {
  const { service } = setup({ imageRegistry: "111122223333.dkr.ecr.ap-south-1.amazonaws.com" });

  const plan = await service.planDeploy({ ...STAGING, version: "v2" });

  assert.equal(plan.image, "111122223333.dkr.ecr.ap-south-1.amazonaws.com/sample-app:v2");
});

test("deploying the version that is already running is refused", async () => {
  const { service, gateway } = setup();
  gateway.seed("staging", "sample-app", "sample-app:v2", 3);

  await assert.rejects(
    service.planDeploy({ ...STAGING, version: "v2" }),
    new InvalidRequestError("sample-app:v2 is already running in staging. Nothing to deploy."),
  );
});

test("the latest tag is refused before anything is read from the cluster", async () => {
  const { service } = setup();

  await assert.rejects(service.planDeploy({ ...STAGING, version: "latest" }), InvalidRequestError);
});

test("an unknown environment or app is refused with the known names", async () => {
  const { service } = setup();

  await assert.rejects(
    service.planDeploy({ environment: "qa", app: "sample-app", version: "v1" }),
    new InvalidRequestError('There is no environment called "qa". I know: staging, prod.'),
  );
  await assert.rejects(
    service.planDeploy({ environment: "staging", app: "billing", version: "v1" }),
    new InvalidRequestError('I don\'t know an app called "billing". I know: sample-app.'),
  );
});

test("a namespace missing from the cluster is reported before the user confirms", async () => {
  const { service, gateway } = setup();
  gateway.namespaces.delete("prod");

  await assert.rejects(
    service.planDeploy({ environment: "prod", app: "sample-app", version: "v1" }),
    new NotFoundError('Namespace "prod" does not exist in this cluster.', "namespaces"),
  );
});

// ---- Deploying ----

test("a deploy reports progress pod by pod and records the result", async () => {
  const { service, gateway, history } = setup();
  gateway.seed("staging", "sample-app", "sample-app:v1", 3);
  const plan = await service.planDeploy({ ...STAGING, version: "v2" });

  const { operation, done } = await service.execute(plan, "asha");
  await done;

  assert.deepEqual(gateway.writes, ["applyService staging sample-app", "applyDeployment staging sample-app:v2 x3"]);
  assert.deepEqual(operation.steps, ["1/3 pods ready", "2/3 pods ready", "3/3 pods ready"]);
  assert.equal(operation.state, "succeeded");
  assert.equal(operation.message, "3/3 pods ready. Deployment ID: dep-001");

  const record = history.latestImageChange("staging", "sample-app");
  assert.equal(record?.status, "succeeded");
  assert.equal(record?.action, "deploy");
  assert.equal(record?.image, "sample-app:v2");
  assert.equal(record?.previousImage, "sample-app:v1");
  assert.equal(record?.requestedBy, "asha");
});

test("a first deploy has no previous image", async () => {
  const { service, history } = setup();
  const plan = await service.planDeploy({ ...STAGING, version: "v1" });

  await (await service.execute(plan, "asha")).done;

  assert.equal(history.latestImageChange("staging", "sample-app")?.previousImage, null);
});

test("the call returns while the rollout is still running", async () => {
  // Waiting never ends in this test, so the rollout stays in its first step.
  const { service, gateway } = setup({ sleep: () => new Promise(() => {}) });
  gateway.seed("staging", "sample-app", "sample-app:v1", 3);
  const plan = await service.planDeploy({ ...STAGING, version: "v2" });

  const { operation } = await service.execute(plan, "asha");

  assert.equal(operation.state, "running");
});

// ---- Rolling back ----

test("a rollback restores the image that ran before the last deploy", async () => {
  const { service, gateway, history } = setup();
  gateway.seed("staging", "sample-app", "sample-app:v1", 3);
  await (await service.execute(await service.planDeploy({ ...STAGING, version: "v2" }), "asha")).done;

  const plan = await service.planRollback(STAGING);
  assert.equal(plan.action, "rollback");
  assert.equal(plan.currentImage, "sample-app:v2");
  assert.equal(plan.image, "sample-app:v1");

  await (await service.execute(plan, "ravi")).done;

  assert.equal((await gateway.getDeployment("staging", "sample-app"))?.image, "sample-app:v1");
  const record = history.latestImageChange("staging", "sample-app");
  assert.equal(record?.action, "rollback");
  assert.equal(record?.previousImage, "sample-app:v2");
  assert.equal(record?.requestedBy, "ravi");
});

test("a rollback is refused when the history holds nothing earlier", async () => {
  const { service, gateway } = setup();
  gateway.seed("staging", "sample-app", "sample-app:v1", 3);

  await assert.rejects(
    service.planRollback(STAGING),
    new InvalidRequestError("There is no earlier deployment of sample-app in staging to roll back to."),
  );
});

test("a rollback after the very first deploy is refused, because nothing ran before it", async () => {
  const { service } = setup();
  await (await service.execute(await service.planDeploy({ ...STAGING, version: "v1" }), "asha")).done;

  await assert.rejects(service.planRollback(STAGING), InvalidRequestError);
});

// ---- Scaling ----

test("scaling changes only the number of replicas", async () => {
  const { service, gateway, history } = setup();
  gateway.seed("staging", "sample-app", "sample-app:v1", 3);

  const plan = await service.planScale({ ...STAGING, replicas: 5 });
  assert.equal(plan.image, "sample-app:v1");
  assert.equal(plan.currentReplicas, 3);

  const { operation, done } = await service.execute(plan, "asha");
  await done;

  assert.deepEqual(gateway.writes.at(-1), "applyDeployment staging sample-app:v1 x5");
  assert.deepEqual(operation.steps, ["4/5 pods ready", "5/5 pods ready"]);
  assert.equal(history.list({ limit: 1 })[0]?.action, "scale");
});

test("scaling down finishes when the extra pods are gone", async () => {
  const { service, gateway } = setup();
  gateway.seed("staging", "sample-app", "sample-app:v1", 5);

  const { operation, done } = await service.execute(await service.planScale({ ...STAGING, replicas: 2 }), "asha");
  await done;

  assert.equal(operation.message, "2/2 pods ready. Deployment ID: dep-001");
});

test("scaling is refused beyond the maximum, when nothing is deployed, and when nothing would change", async () => {
  const { service, gateway } = setup();

  await assert.rejects(
    service.planScale({ ...STAGING, replicas: 3 }),
    new InvalidRequestError("sample-app is not deployed in staging yet, so there is nothing to scale."),
  );

  gateway.seed("staging", "sample-app", "sample-app:v1", 3);
  await assert.rejects(
    service.planScale({ ...STAGING, replicas: 500 }),
    new InvalidRequestError("sample-app can have at most 10 replicas. You asked for 500."),
  );
  await assert.rejects(
    service.planScale({ ...STAGING, replicas: 3 }),
    new InvalidRequestError("sample-app in staging already has 3 replicas."),
  );
});

// ---- Two changes at once ----

test("two confirmations at the same moment: one runs, the other is refused", async () => {
  const { service, gateway } = setup({ sleep: () => new Promise(() => {}) });
  gateway.seed("staging", "sample-app", "sample-app:v1", 3);
  const first = await service.planDeploy({ ...STAGING, version: "v2" });
  const second = await service.planDeploy({ ...STAGING, version: "v3" });

  const results = await Promise.allSettled([service.execute(first, "asha"), service.execute(second, "ravi")]);

  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  assert.ok(results[1].status === "rejected" && results[1].reason instanceof DeployInProgressError);
  assert.equal(
    results[1].status === "rejected" && results[1].reason.message,
    "staging already has a deployment in progress (dep-001, started by asha). Try again when it finishes.",
  );
  assert.deepEqual(gateway.writes, ["applyService staging sample-app", "applyDeployment staging sample-app:v2 x3"]);
});

test("a later confirmation is also refused while the first rollout is still running", async () => {
  const { service, gateway } = setup({ sleep: () => new Promise(() => {}) });
  gateway.seed("staging", "sample-app", "sample-app:v1", 3);
  const second = await service.planDeploy({ ...STAGING, version: "v3" });
  await service.execute(await service.planDeploy({ ...STAGING, version: "v2" }), "asha");

  await assert.rejects(service.execute(second, "ravi"), DeployInProgressError);
});

test("a deploy to another environment is not held up", async () => {
  const { service, gateway } = setup({ sleep: () => new Promise(() => {}) });
  gateway.seed("staging", "sample-app", "sample-app:v1", 3);
  gateway.seed("prod", "sample-app", "sample-app:v1", 3);
  await service.execute(await service.planDeploy({ ...STAGING, version: "v2" }), "asha");

  const prod = await service.execute(
    await service.planDeploy({ environment: "prod", app: "sample-app", version: "v2" }),
    "ravi",
  );

  assert.equal(prod.operation.state, "running");
});

test("a confirmation is refused when the environment changed after the summary was shown", async () => {
  const { service, gateway } = setup();
  gateway.seed("staging", "sample-app", "sample-app:v1", 3);
  const plan = await service.planDeploy({ ...STAGING, version: "v2" });
  gateway.seed("staging", "sample-app", "sample-app:v3", 3); // someone else got there first

  await assert.rejects(
    service.execute(plan, "asha"),
    new InvalidRequestError(
      "staging changed after I showed you the summary (it now runs sample-app:v3 with 3 replicas). Please ask again.",
    ),
  );
  assert.deepEqual(gateway.writes, []);
});

// ---- Rollouts that go wrong ----

test("a wrong image name fails quickly and explains the image was not found", async () => {
  const { service, gateway, history, elapsedMs } = setup();
  gateway.seed("staging", "sample-app", "sample-app:v1", 3);
  gateway.rollout = "imageNotFound";

  const { operation, done } = await service.execute(await service.planDeploy({ ...STAGING, version: "v9" }), "asha");
  await done;

  assert.equal(operation.state, "failed");
  assert.equal(
    operation.message,
    "Deployment dep-001 failed: Image sample-app:v9 was not found, or the cluster is not allowed to pull it. " +
      'The old version is still running. Type "roll back staging" to return to sample-app:v1.',
  );
  assert.equal(history.latestImageChange("staging", "sample-app")?.status, "failed");
  assert.ok(elapsedMs() < 10_000, "must not wait for the full rollout timeout");
});

test("a version that crashes on start fails with its last log line", async () => {
  const { service, gateway } = setup();
  gateway.seed("staging", "sample-app", "sample-app:v2", 3);
  gateway.rollout = "crashLoop";

  const { operation, done } = await service.execute(await service.planDeploy({ ...STAGING, version: "v3" }), "asha");
  await done;

  assert.equal(operation.state, "failed");
  assert.ok(
    operation.message.includes(
      'Container keeps crashing (3 restarts, exit code 1). Last log line: "Fatal: cannot read /etc/app/config.json". The old version is still running.',
    ),
    operation.message,
  );
});

test("a rollout that never finishes times out and says why the pods are not ready", async () => {
  const { service, gateway, history, elapsedMs } = setup();
  gateway.seed("staging", "sample-app", "sample-app:v1", 3);
  gateway.rollout = "stall";

  const { operation, done } = await service.execute(await service.planDeploy({ ...STAGING, version: "v2" }), "asha");
  await done;

  assert.equal(operation.state, "failed");
  assert.equal(
    operation.message,
    "The rollout did not finish in 180 seconds: 0/3 pods ready on the new version. " +
      "Pending: not enough memory on the nodes. " +
      'The old version is still running. Type "roll back staging" to return to sample-app:v1. ' +
      "Deployment ID: dep-001",
  );
  assert.equal(history.latestImageChange("staging", "sample-app")?.status, "timed_out");
  assert.ok(elapsedMs() >= 180_000);
});

test("the environment is free again after a failed rollout", async () => {
  const { service, gateway } = setup();
  gateway.seed("staging", "sample-app", "sample-app:v1", 3);
  gateway.rollout = "imageNotFound";
  await (await service.execute(await service.planDeploy({ ...STAGING, version: "v9" }), "asha")).done;

  gateway.rollout = "succeed";
  const { operation, done } = await service.execute(await service.planRollback(STAGING), "asha");
  await done;

  assert.equal(operation.state, "succeeded");
  assert.equal((await gateway.getDeployment("staging", "sample-app"))?.image, "sample-app:v1");
});

test("an error while applying is recorded in the history and passed on", async () => {
  const { service, gateway, history } = setup();
  const refused = new ForbiddenError("The assistant is not allowed to create the deployment in namespace staging.");
  const plan = await service.planDeploy({ ...STAGING, version: "v1" });
  gateway.failNext("applyDeployment", refused);

  await assert.rejects(service.execute(plan, "asha"), refused);

  const record = history.latestImageChange("staging", "sample-app");
  assert.equal(record?.status, "failed");
  assert.equal(record?.message, refused.message);
});

test("losing the cluster during a rollout ends the operation with a clear message", async () => {
  const { service, gateway, history } = setup();
  gateway.seed("staging", "sample-app", "sample-app:v1", 3);
  const plan = await service.planDeploy({ ...STAGING, version: "v2" });
  gateway.failNext("listPods", new ClusterUnreachableError('I can\'t reach the cluster (context "fake-cluster").'));

  const { operation, done } = await service.execute(plan, "asha");
  await done;

  assert.equal(operation.state, "failed");
  assert.equal(
    operation.message,
    'I lost track of the rollout: I can\'t reach the cluster (context "fake-cluster"). Deployment ID: dep-001',
  );
  assert.equal(history.latestImageChange("staging", "sample-app")?.status, "failed");
});

// ---- Services saved in the registry ----

const ORDERS_API: ServiceSpec = {
  name: "orders-api",
  environment: "staging",
  imageRepository: "orders-api",
  folder: null,
  port: 3000,
  healthPath: "/healthz",
  replicas: 2,
  maxReplicas: 4,
  resources: { requests: { cpu: "200m", memory: "64Mi" }, limits: { cpu: "300m", memory: "96Mi" } },
  env: [{ name: "NODE_ENV", value: "production" }],
  lastVersion: 0,
};

test("a saved service is deployed with its own port, health path, resources and variables", async () => {
  const { service, gateway, registry } = setup();
  registry.save(ORDERS_API);

  const plan = await service.planDeploy({ environment: "staging", app: "orders-api", version: "v1" });
  const { done } = await service.execute(plan, "asha");
  await done;

  assert.equal(plan.image, "orders-api:v1");
  assert.equal(plan.replicas, 2);
  const manifest = gateway.manifests.get("staging/orders-api");
  const podSpec = manifest?.spec as { template: { spec: { containers: Record<string, unknown>[] } } };
  const container = podSpec.template.spec.containers[0];
  assert.deepEqual(container.ports, [{ containerPort: 3000 }]);
  assert.deepEqual(container.readinessProbe, {
    httpGet: { path: "/healthz", port: 3000 },
    initialDelaySeconds: 2,
    periodSeconds: 5,
  });
  assert.deepEqual(container.resources, ORDERS_API.resources);
  assert.deepEqual(container.env, [{ name: "NODE_ENV", value: "production" }]);
});

test("a saved service is scaled up to its own maximum and no further", async () => {
  const { service, gateway, registry } = setup();
  registry.save(ORDERS_API);
  gateway.seed("staging", "orders-api", "orders-api:v1", 2);

  await assert.rejects(
    service.planScale({ environment: "staging", app: "orders-api", replicas: 5 }),
    new InvalidRequestError("orders-api can have at most 4 replicas. You asked for 5."),
  );
  assert.equal((await service.planScale({ environment: "staging", app: "orders-api", replicas: 4 })).replicas, 4);
});

test("a service saved for staging cannot be deployed to prod", async () => {
  const { service, registry } = setup();
  registry.save(ORDERS_API);

  await assert.rejects(
    service.planDeploy({ environment: "prod", app: "orders-api", version: "v1" }),
    new InvalidRequestError('I don\'t know an app called "orders-api". I know: sample-app.'),
  );
});

// ---- Services built from a project folder ----

const FOLDER = "/Users/asha/code/orders-api";
/** What the chat's questions hand over: the settings, before any image was built. */
const NEW_SERVICE: ServiceSpec = { ...ORDERS_API, folder: FOLDER };

function setupWithBuild(options: { registry?: string; withInfra?: boolean } = {}) {
  const build = new FakeBuildTools(options);
  return { ...setup({ build }), build };
}

test("planning a new service picks version v1 and changes nothing", async () => {
  const { service, gateway, registry, build } = setupWithBuild();

  const plan = await service.planCreate(NEW_SERVICE);

  assert.equal(plan.action, "create");
  assert.equal(plan.image, "orders-api:v1");
  assert.equal(plan.buildFrom, FOLDER);
  assert.equal(plan.currentImage, null);
  assert.equal(plan.replicas, 2);
  assert.equal(plan.spec?.lastVersion, 1);
  assert.deepEqual(gateway.writes, []);
  assert.deepEqual(build.calls, []);
  assert.equal(registry.find("staging", "orders-api"), null);
});

test("Confirm on a new service answers at once, while the image is still being built", async () => {
  const { service, gateway, registry, build } = setupWithBuild();
  const release = build.hold("build");

  const { operation, done } = await service.execute(await service.planCreate(NEW_SERVICE), "asha");

  assert.equal(operation.state, "running");
  assert.deepEqual(operation.stages, ["build", "publish", "pods"]);
  assert.equal(operation.stage, "build");
  assert.deepEqual(gateway.writes, []);
  // The answers are kept from now on, whatever happens to the build.
  assert.equal(registry.find("staging", "orders-api")?.port, 3000);

  release();
  await done;
});

test("a new service is built, handed to the cluster and only then deployed with its settings", async () => {
  const { service, gateway, history, build } = setupWithBuild();

  const { operation, done } = await service.execute(await service.planCreate(NEW_SERVICE), "asha");
  await done;

  assert.deepEqual(build.calls, [`build ${FOLDER} orders-api:v1`, "publish orders-api:v1"]);
  assert.deepEqual(gateway.writes, ["applyService staging orders-api", "applyDeployment staging orders-api:v1 x2"]);
  const podSpec = gateway.manifests.get("staging/orders-api")?.spec as {
    template: { spec: { containers: Record<string, unknown>[] } };
  };
  assert.deepEqual(podSpec.template.spec.containers[0].env, [{ name: "NODE_ENV", value: "production" }]);
  assert.equal(operation.state, "succeeded");
  assert.equal(operation.stage, "pods");
  assert.equal(operation.message, "2/2 pods ready. Deployment ID: dep-001");
  const record = history.latest("staging", "orders-api");
  assert.equal(record?.action, "create");
  assert.equal(record?.status, "succeeded");
  assert.equal(record?.previousImage, null);
});

test("on a cluster with an image registry, the repository is prepared first and the image carries the registry", async () => {
  const { service, build } = setupWithBuild({ registry: "123456789012.dkr.ecr.ap-south-1.amazonaws.com/demo", withInfra: true });
  const image = "123456789012.dkr.ecr.ap-south-1.amazonaws.com/demo/orders-api:v1";

  const plan = await service.planCreate(NEW_SERVICE);
  const { operation, done } = await service.execute(plan, "asha");
  await done;

  assert.equal(plan.image, image);
  assert.deepEqual(operation.stages, ["repository", "build", "publish", "pods"]);
  assert.deepEqual(build.calls, ["ensure orders-api", `build ${FOLDER} ${image}`, `publish ${image}`]);
});

test("a build that fails ends the change, applies nothing, frees the environment and keeps the settings", async () => {
  const { service, gateway, history, registry, build } = setupWithBuild();
  build.failNext("build", new CommandFailedError('"docker build" failed: COPY failed: file not found'));

  const { operation, done } = await service.execute(await service.planCreate(NEW_SERVICE), "asha");
  await done;

  assert.equal(operation.state, "failed");
  assert.equal(operation.stage, "build");
  assert.equal(
    operation.message,
    'Deployment dep-001 failed while building the image: "docker build" failed: COPY failed: file not found ' +
      'Fix it, then type "deploy orders-api to staging" to try again.',
  );
  assert.deepEqual(gateway.writes, []);
  assert.equal(history.latest("staging", "orders-api")?.status, "failed");
  history.assertFree("staging");
  assert.equal(registry.find("staging", "orders-api")?.lastVersion, 1);
});

test("a failure while the image is handed to the cluster is reported for that stage", async () => {
  const { service, build } = setupWithBuild();
  build.failNext("publish", new CommandFailedError('"kind load" failed: no nodes found'));

  const { operation, done } = await service.execute(await service.planCreate(NEW_SERVICE), "asha");
  await done;

  assert.equal(operation.stage, "publish");
  assert.match(operation.message, /failed while uploading the image: "kind load" failed: no nodes found/);
});

test("deploying a folder service again builds the next version; after a failed build too", async () => {
  const { service, registry, build } = setupWithBuild();
  build.failNext("build", new CommandFailedError('"docker build" failed: oops'));
  await (await service.execute(await service.planCreate(NEW_SERVICE), "asha")).done;

  const plan = await service.planRebuild({ environment: "staging", app: "orders-api" });
  await (await service.execute(plan, "asha")).done;

  assert.equal(plan.action, "deploy");
  assert.equal(plan.image, "orders-api:v2");
  assert.equal(plan.buildFrom, FOLDER);
  assert.equal(plan.currentImage, null);
  assert.equal(registry.find("staging", "orders-api")?.lastVersion, 2);
  assert.equal(build.calls.at(-1), "publish orders-api:v2");
});

test("a rebuild of a running service keeps its replicas and names what runs now", async () => {
  const { service, gateway, registry } = setupWithBuild();
  registry.save({ ...NEW_SERVICE, lastVersion: 1 });
  gateway.seed("staging", "orders-api", "orders-api:v1", 3);

  const plan = await service.planRebuild({ environment: "staging", app: "orders-api" });

  assert.equal(plan.image, "orders-api:v2");
  assert.equal(plan.currentImage, "orders-api:v1");
  assert.equal(plan.replicas, 3);
});

test("a service that is not built from a folder cannot be rebuilt: it needs a version", async () => {
  const { service } = setupWithBuild();

  await assert.rejects(
    service.planRebuild(STAGING),
    new InvalidRequestError(
      "sample-app is not built from a folder. Name the version to deploy, for example: deploy sample-app version v2 to staging",
    ),
  );
});

test("another change to the environment is refused while a build is running", async () => {
  const { service, build } = setupWithBuild();
  const release = build.hold("build");
  const { done } = await service.execute(await service.planCreate(NEW_SERVICE), "asha");

  const other = await service.planDeploy({ ...STAGING, version: "v2" });
  await assert.rejects(service.execute(other, "ravi"), DeployInProgressError);

  release();
  await done;
});

test("a name that is already a service in that environment is refused", async () => {
  const { service, registry } = setupWithBuild();
  registry.save(ORDERS_API);

  await assert.rejects(
    service.planCreate(NEW_SERVICE),
    new InvalidRequestError("There is already a service called orders-api in staging."),
  );
});

test("a name that a deployment the assistant did not create already uses is refused", async () => {
  const { service, gateway } = setupWithBuild();
  gateway.seed("staging", "orders-api", "someone-elses:1", 1);

  await assert.rejects(
    service.planCreate(NEW_SERVICE),
    new InvalidRequestError(
      "A deployment called orders-api already runs in staging, and I did not create it. Pick another name.",
    ),
  );
});

test("on a cluster the assistant cannot build for, creating a service is refused with the reason", async () => {
  const { service } = setup();

  await assert.rejects(
    service.planCreate(NEW_SERVICE),
    new InvalidRequestError(
      "I can build images only for a kind cluster or an EKS cluster, and this cluster is neither.",
    ),
  );
});

// ---- Changing a service's settings ----

/** orders-api v1 runs in staging with 2 pods and is in the registry. */
function setupRunningService() {
  const all = setupWithBuild();
  all.registry.save({ ...NEW_SERVICE, lastVersion: 1 });
  all.gateway.seed("staging", "orders-api", "orders-api:v1", 2);
  return all;
}

const MORE_MEMORY: ServiceSpec = {
  ...NEW_SERVICE,
  lastVersion: 1,
  resources: { requests: { cpu: "200m", memory: "64Mi" }, limits: { cpu: "300m", memory: "512Mi" } },
};

test("a settings change keeps the image and the replicas, and shows the settings before and after", async () => {
  const { service, gateway } = setupRunningService();

  const plan = await service.planConfigure(MORE_MEMORY);

  assert.equal(plan.action, "configure");
  assert.equal(plan.image, "orders-api:v1");
  assert.equal(plan.currentImage, "orders-api:v1");
  assert.equal(plan.replicas, 2);
  assert.equal(plan.spec?.resources.limits.memory, "512Mi");
  assert.equal(plan.previousSpec?.resources.limits.memory, "96Mi");
  assert.equal(plan.buildFrom, undefined);
  assert.deepEqual(gateway.writes, []);
});

test("a confirmed settings change is applied, stored and recorded, without building", async () => {
  const { service, gateway, history, registry, build } = setupRunningService();

  const { operation, done } = await service.execute(await service.planConfigure(MORE_MEMORY), "asha");
  await done;

  const podSpec = gateway.manifests.get("staging/orders-api")?.spec as {
    template: { spec: { containers: { resources: unknown }[] } };
  };
  assert.deepEqual(podSpec.template.spec.containers[0].resources, MORE_MEMORY.resources);
  assert.equal(registry.find("staging", "orders-api")?.resources.limits.memory, "512Mi");
  assert.equal(history.latest("staging", "orders-api")?.action, "configure");
  assert.equal(operation.state, "succeeded");
  assert.equal(operation.stages, undefined);
  assert.deepEqual(build.calls, []);
});

test("a settings change that changes nothing, or on a service that is not running, is refused", async () => {
  const { service, registry } = setupRunningService();

  await assert.rejects(
    service.planConfigure({ ...NEW_SERVICE, lastVersion: 1 }),
    new InvalidRequestError("orders-api in staging has exactly these settings already. Nothing to change."),
  );

  registry.save({ ...NEW_SERVICE, environment: "prod", lastVersion: 1 });
  await assert.rejects(
    service.planConfigure({ ...MORE_MEMORY, environment: "prod" }),
    new InvalidRequestError(
      'orders-api is not running in prod yet, so there is nothing to change. To start it, type: deploy orders-api to prod',
    ),
  );
});

test("roll back after a settings change still returns to the image before the last deploy", async () => {
  const { service, registry } = setupRunningService();
  registry.save({ ...NEW_SERVICE, lastVersion: 1 });
  await (await service.execute(await service.planRebuild({ environment: "staging", app: "orders-api" }), "asha")).done;
  await (await service.execute(await service.planConfigure({ ...MORE_MEMORY, lastVersion: 2 }), "asha")).done;

  const plan = await service.planRollback({ environment: "staging", app: "orders-api" });

  assert.equal(plan.image, "orders-api:v1");
  assert.equal(plan.currentImage, "orders-api:v2");
});
