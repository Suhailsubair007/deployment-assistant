import assert from "node:assert/strict";
import { test } from "node:test";

import { OperationStore } from "../src/services/operationStore.ts";

const input = { deploymentId: 7, environment: "staging", app: "sample-app" };

test("a new operation is running and has no progress yet", () => {
  const store = new OperationStore();

  const operation = store.create(input);

  assert.equal(operation.state, "running");
  assert.deepEqual(operation.steps, []);
  assert.equal(store.get(operation.id), operation);
});

test("progress steps are kept in order, without repeating the same step twice in a row", () => {
  const store = new OperationStore();
  const { id } = store.create(input);

  for (const step of ["1/3 pods ready", "1/3 pods ready", "2/3 pods ready", "3/3 pods ready"]) {
    store.addStep(id, step);
  }

  assert.deepEqual(store.get(id)?.steps, ["1/3 pods ready", "2/3 pods ready", "3/3 pods ready"]);
});

test("finishing an operation stores how it ended and the final message", () => {
  const store = new OperationStore();
  const { id } = store.create(input);

  store.finish(id, "failed", "Image sample-app:v9 was not found");

  assert.equal(store.get(id)?.state, "failed");
  assert.equal(store.get(id)?.message, "Image sample-app:v9 was not found");
});

test("an unknown operation ID gives null", () => {
  assert.equal(new OperationStore().get("no-such-id"), null);
});

test("only the most recent operations are kept, so memory does not grow forever", () => {
  const store = new OperationStore(2);
  const first = store.create(input);
  store.create(input);
  store.create(input);

  assert.equal(store.get(first.id), null);
});
