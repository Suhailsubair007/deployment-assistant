import assert from "node:assert/strict";
import { test } from "node:test";

import { buildRolloutSteps } from "@/lib/rollout-steps.ts";

const statesOf = (steps: { state: string }[]) => steps.map((step) => step.state);

test("a change always has the same three steps in the same order", () => {
  assert.deepEqual(
    buildRolloutSteps("running", null).map((step) => step.id),
    ["sent", "pods", "finished"],
  );
});

test("a running change has sent the change and is starting the pods", () => {
  assert.deepEqual(statesOf(buildRolloutSteps("running", { ready: 1, total: 3 })), ["done", "active", "pending"]);
});

test("a change that succeeded has every step done", () => {
  assert.deepEqual(statesOf(buildRolloutSteps("succeeded", { ready: 3, total: 3 })), ["done", "done", "done"]);
});

test("a change that failed stops at the pods and never finishes", () => {
  assert.deepEqual(statesOf(buildRolloutSteps("failed", { ready: 0, total: 3 })), ["done", "failed", "pending"]);
});

test("a change the page lost contact with is not shown as failed", () => {
  assert.deepEqual(statesOf(buildRolloutSteps("unknown", null)), ["done", "pending", "pending"]);
});

test("the pods step says how many pods are ready", () => {
  assert.equal(buildRolloutSteps("running", { ready: 2, total: 3 })[1]?.detail, "2 of 3 ready");
});

test("before the first count arrives, the pods step says it is waiting", () => {
  assert.equal(buildRolloutSteps("running", null)[1]?.detail, "Waiting for the first pod");
});

test("without a count, a change that is not running has no detail", () => {
  assert.equal(buildRolloutSteps("unknown", null)[1]?.detail, "");
});
