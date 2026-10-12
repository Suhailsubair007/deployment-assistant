import assert from "node:assert/strict";
import { test } from "node:test";

import { DeployInProgressError } from "../src/errors.ts";
import { formatDeploymentId, HistoryStore } from "../src/services/historyStore.ts";
import type { NewDeployment } from "../src/services/historyStore.ts";

function deployTo(environment: string, overrides: Partial<NewDeployment> = {}): NewDeployment {
  return {
    environment,
    app: "sample-app",
    action: "deploy",
    image: "sample-app:v2",
    previousImage: "sample-app:v1",
    replicas: 3,
    requestedBy: "asha",
    ...overrides,
  };
}

/** A store that lives in memory, so tests leave no file behind. */
function newStore(): HistoryStore {
  return new HistoryStore(":memory:");
}

test("deployment IDs are shown as dep- followed by three digits", () => {
  assert.equal(formatDeploymentId(7), "dep-007");
  assert.equal(formatDeploymentId(1234), "dep-1234");
});

test("a started deployment is stored as in progress with everything that was asked", () => {
  const store = newStore();

  const record = store.start(deployTo("staging"));

  assert.equal(record.id, 1);
  assert.equal(record.status, "in_progress");
  assert.equal(record.environment, "staging");
  assert.equal(record.image, "sample-app:v2");
  assert.equal(record.previousImage, "sample-app:v1");
  assert.equal(record.replicas, 3);
  assert.equal(record.requestedBy, "asha");
  assert.ok(record.startedAt instanceof Date);
  assert.equal(record.finishedAt, null);
});

test("finishing a deployment stores its status, message and end time", () => {
  const store = newStore();
  const { id } = store.start(deployTo("staging"));

  store.finish(id, "failed", "Image sample-app:v9 was not found");

  const stored = store.latestImageChange("staging", "sample-app");
  assert.equal(stored?.status, "failed");
  assert.equal(stored?.message, "Image sample-app:v9 was not found");
  assert.ok(stored?.finishedAt instanceof Date);
});

test("a second deployment to the same environment is refused while one is in progress", () => {
  const store = newStore();
  store.start(deployTo("staging"));

  assert.throws(
    () => store.start(deployTo("staging", { requestedBy: "ravi" })),
    new DeployInProgressError(
      "staging already has a deployment in progress (dep-001, started by asha). Try again when it finishes.",
    ),
  );
});

test("a deployment to another environment is allowed at the same time", () => {
  const store = newStore();
  store.start(deployTo("staging"));

  assert.equal(store.start(deployTo("prod")).status, "in_progress");
});

test("an environment is free again once its deployment has finished", () => {
  const store = newStore();
  const first = store.start(deployTo("staging"));
  store.finish(first.id, "succeeded");

  assert.equal(store.start(deployTo("staging")).id, 2);
});

test("the list shows the newest deployments first and respects the limit", () => {
  const store = newStore();
  for (const image of ["sample-app:v1", "sample-app:v2", "sample-app:v3"]) {
    store.finish(store.start(deployTo("staging", { image })).id, "succeeded");
  }

  const images = store.list({ limit: 2 }).map((record) => record.image);

  assert.deepEqual(images, ["sample-app:v3", "sample-app:v2"]);
});

test("the list can be narrowed to one requester and one environment", () => {
  const store = newStore();
  store.finish(store.start(deployTo("staging", { requestedBy: "asha" })).id, "succeeded");
  store.finish(store.start(deployTo("prod", { requestedBy: "ravi" })).id, "succeeded");
  store.finish(store.start(deployTo("prod", { requestedBy: "asha" })).id, "succeeded");

  assert.equal(store.list({ limit: 10, requestedBy: "asha" }).length, 2);
  assert.equal(store.list({ limit: 10, environment: "prod" }).length, 2);
  assert.equal(store.list({ limit: 10, requestedBy: "ravi", environment: "staging" }).length, 0);
});

test("the latest image change skips scaling, which does not change the image", () => {
  const store = newStore();
  store.finish(store.start(deployTo("staging")).id, "succeeded");
  store.finish(store.start(deployTo("staging", { action: "scale", previousImage: "sample-app:v2" })).id, "succeeded");

  const latest = store.latestImageChange("staging", "sample-app");

  assert.equal(latest?.action, "deploy");
  assert.equal(latest?.previousImage, "sample-app:v1");
});

test("there is no latest image change for an environment that was never deployed to", () => {
  assert.equal(newStore().latestImageChange("prod", "sample-app"), null);
});

test("deployments left in progress by a crash are marked interrupted, which frees the environment", () => {
  const store = newStore();
  store.start(deployTo("staging"));

  assert.equal(store.recoverInterrupted(), 1);

  assert.equal(store.latestImageChange("staging", "sample-app")?.status, "interrupted");
  assert.equal(store.start(deployTo("staging")).status, "in_progress");
});
