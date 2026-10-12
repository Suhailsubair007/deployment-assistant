import assert from "node:assert/strict";
import { test } from "node:test";

import { loadConfig } from "../src/config.ts";
import {
  ClusterUnreachableError,
  DeployInProgressError,
  ForbiddenError,
  InvalidRequestError,
  NotFoundError,
} from "../src/errors.ts";
import { DeploymentService } from "../src/services/deploymentService.ts";
import { FailureExplainer } from "../src/services/failureExplainer.ts";
import { HistoryStore } from "../src/services/historyStore.ts";
import { OperationStore } from "../src/services/operationStore.ts";
import { FakeGateway } from "./helpers/fakeGateway.ts";

const STAGING = { environment: "staging", app: "sample-app" };

/**
 * A service wired to a pretend cluster. Waiting is replaced by a clock the test
 * controls, so a "180 second" rollout finishes at once.
 */
function setup(options: { imageRegistry?: string; sleep?: (ms: number) => Promise<void> } = {}) {
  const gateway = new FakeGateway();
  const history = new HistoryStore(":memory:");
  const operations = new OperationStore();
  let clockMs = 0;
  const service = new DeploymentService({
    gateway,
    history,
    operations,
    config: loadConfig("config/app.config.yaml"),
    explainer: new FailureExplainer(gateway),
    imageRegistry: options.imageRegistry,
    sleep:
      options.sleep ??
      (async (ms) => {
        clockMs += ms;
      }),
    now: () => clockMs,
  });
  return { gateway, history, operations, service, elapsedMs: () => clockMs };
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
    new InvalidRequestError("sample-app can have at most 10 replicas (maxReplicas in the config file). You asked for 500."),
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
