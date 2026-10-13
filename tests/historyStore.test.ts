import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { DeployInProgressError } from "@/errors.ts";
import { formatDeploymentId, HistoryStore } from "@/services/historyStore.ts";
import type { NewDeployment } from "@/types/deployment.ts";

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
  return new HistoryStore(":memory:", "kind-test");
}

/** A history file in a new temporary folder. A file, because two stores have to share it. */
function newFile(): string {
  return join(mkdtempSync(join(tmpdir(), "history-")), "history.db");
}

/** Two stores on one file, each for another cluster: what happens when the app is pointed at a second cluster. */
function twoClusters(): { kind: HistoryStore; eks: HistoryStore } {
  const file = newFile();
  return { kind: new HistoryStore(file, "kind-local"), eks: new HistoryStore(file, "eks-staging") };
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

test("the latest change of any kind includes scaling", () => {
  const store = newStore();
  store.finish(store.start(deployTo("staging")).id, "succeeded");
  store.finish(store.start(deployTo("staging", { action: "scale" })).id, "succeeded");

  assert.equal(store.latest("staging", "sample-app")?.action, "scale");
  assert.equal(store.latest("prod", "sample-app"), null);
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

// ---- One history file, more than one cluster ----

test("a deployment is stored with the cluster it was made on", () => {
  assert.equal(newStore().start(deployTo("staging")).cluster, "kind-test");
});

test("the list shows only the deployments of the cluster in use", () => {
  const { kind, eks } = twoClusters();
  kind.start(deployTo("staging"));

  assert.equal(kind.list({ limit: 10 }).length, 1);
  assert.deepEqual(eks.list({ limit: 10 }), []);
});

test("the image to roll back to is never taken from another cluster", () => {
  const { kind, eks } = twoClusters();
  const { id } = kind.start(deployTo("staging"));
  kind.finish(id, "succeeded");

  assert.equal(eks.latestImageChange("staging", "sample-app"), null);
  assert.equal(eks.latest("staging", "sample-app"), null);
  assert.equal(kind.latestImageChange("staging", "sample-app")?.previousImage, "sample-app:v1");
});

test("a change that runs on one cluster does not lock the same environment on another", () => {
  const { kind, eks } = twoClusters();
  kind.start(deployTo("staging"));

  eks.assertFree("staging");
  eks.start(deployTo("staging"));

  // On its own cluster the environment is still taken.
  assert.throws(() => kind.start(deployTo("staging")), DeployInProgressError);
});

test("a restart marks the unfinished deployments of every cluster as interrupted", () => {
  // The process that was following them is gone, whichever cluster they were on.
  const { kind, eks } = twoClusters();
  kind.start(deployTo("staging"));

  assert.equal(eks.recoverInterrupted(), 1);
  kind.assertFree("staging");
});

test("a history file from before the cluster was recorded keeps its deployments, under the cluster in use", () => {
  const file = newFile();
  const old = new DatabaseSync(file);
  // The table and the lock as they were before the "cluster" column.
  old.exec(`
    CREATE TABLE deployments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, environment TEXT NOT NULL, app TEXT NOT NULL, action TEXT NOT NULL,
      image TEXT NOT NULL, previous_image TEXT, replicas INTEGER NOT NULL, status TEXT NOT NULL,
      requested_by TEXT NOT NULL, message TEXT, started_at TEXT NOT NULL, finished_at TEXT
    );
    CREATE UNIQUE INDEX one_active_deployment_per_environment ON deployments (environment) WHERE status = 'in_progress';
    INSERT INTO deployments (environment, app, action, image, replicas, status, requested_by, started_at)
      VALUES ('staging', 'sample-app', 'deploy', 'sample-app:v1', 3, 'succeeded', 'asha', '2026-10-12T10:00:00.000Z');
  `);
  old.close();

  const store = new HistoryStore(file, "kind-local");

  const [record] = store.list({ limit: 10 });
  assert.equal(record?.image, "sample-app:v1");
  assert.equal(record?.cluster, "kind-local");
  // Opening the file for another cluster later does not move them again.
  assert.deepEqual(new HistoryStore(file, "eks-staging").list({ limit: 10 }), []);
  assert.equal(store.list({ limit: 10 }).length, 1);
});

test("a settings change is not what roll back returns from: the last image change stays the deploy", () => {
  const store = newStore();
  const deploy = store.start(deployTo("staging"));
  store.finish(deploy.id, "succeeded");
  const edit = store.start(
    deployTo("staging", { action: "configure", image: "sample-app:v2", previousImage: "sample-app:v2" }),
  );
  store.finish(edit.id, "succeeded");

  assert.equal(store.latestImageChange("staging", "sample-app")?.id, deploy.id);
  assert.equal(store.latest("staging", "sample-app")?.id, edit.id);
});
