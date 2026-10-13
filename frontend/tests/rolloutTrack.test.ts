import assert from "node:assert/strict";
import { test } from "node:test";

import { podPosition, runnerPosition } from "@/lib/rollout-track.ts";

test("the pods stand evenly between the two ends of the track", () => {
  assert.deepEqual(
    [0, 1, 2].map((index) => podPosition(index, 3)),
    [0.25, 0.5, 0.75],
  );
});

test("before the first count arrives, Rollo is at the start", () => {
  assert.equal(runnerPosition("running", null), 0);
});

test("Rollo is halfway to the pod that is starting now", () => {
  // One of three pods is ready: between the first pod (0.25) and the second (0.5).
  assert.equal(runnerPosition("running", { ready: 1, total: 3 }), 0.375);
});

test("Rollo reaches the end only when the change has succeeded", () => {
  assert.ok(runnerPosition("running", { ready: 3, total: 3 }) < 1);
  assert.equal(runnerPosition("succeeded", { ready: 3, total: 3 }), 1);
});

test("a change that failed leaves Rollo at the pod that did not start", () => {
  assert.equal(runnerPosition("failed", { ready: 0, total: 3 }), 0.125);
});

test("more ready pods than were asked for do not carry Rollo past the last pod", () => {
  assert.equal(runnerPosition("running", { ready: 5, total: 3 }), runnerPosition("running", { ready: 3, total: 3 }));
});
