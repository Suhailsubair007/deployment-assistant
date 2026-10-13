import assert from "node:assert/strict";
import { test } from "node:test";

import { podPosition, runnerPosition, trackParts } from "@/lib/rollout-track.ts";

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

// A change that builds an image: every stage has its own part of the track.

const LOCAL_STAGES = ["build", "publish", "pods"] as const;
const AWS_STAGES = ["repository", "build", "publish", "pods"] as const;

test("without stages the pods have the whole track", () => {
  assert.deepEqual(trackParts(undefined), [{ stage: "pods", start: 0, end: 1 }]);
});

test("the pods get half of the track and the stages before them share the rest", () => {
  assert.deepEqual(trackParts([...LOCAL_STAGES]), [
    { stage: "build", start: 0, end: 0.25 },
    { stage: "publish", start: 0.25, end: 0.5 },
    { stage: "pods", start: 0.5, end: 1 },
  ]);
});

test("a fourth stage does not take room from the pods", () => {
  const parts = trackParts([...AWS_STAGES]);

  assert.deepEqual(
    parts.map((part) => part.stage),
    ["repository", "build", "publish", "pods"],
  );
  assert.deepEqual(parts.at(-1), { stage: "pods", start: 0.5, end: 1 });
});

test("the pods of a change that builds an image stand evenly in their own part", () => {
  const podsPart = trackParts([...LOCAL_STAGES]).at(-1);

  assert.deepEqual(
    [0, 1, 2].map((index) => podPosition(index, 3, podsPart)),
    [0.625, 0.75, 0.875],
  );
});

test("while a stage before the pods runs, Rollo is in the middle of its part", () => {
  assert.equal(runnerPosition("running", null, [...LOCAL_STAGES], "build"), 0.125);
  assert.equal(runnerPosition("running", null, [...LOCAL_STAGES], "publish"), 0.375);
});

test("when the pods stage starts, Rollo is where the pods begin", () => {
  assert.equal(runnerPosition("running", null, [...LOCAL_STAGES], "pods"), 0.5);
});

test("in the pods stage, Rollo is halfway to the pod that is starting now", () => {
  // One of three pods is ready: between the first pod (0.625) and the second (0.75).
  assert.equal(runnerPosition("running", { ready: 1, total: 3 }, [...LOCAL_STAGES], "pods"), 0.6875);
});

test("a build that failed leaves Rollo in the build part", () => {
  assert.equal(runnerPosition("failed", null, [...LOCAL_STAGES], "build"), 0.125);
});

test("a change that built an image and succeeded brings Rollo to the end", () => {
  assert.equal(runnerPosition("succeeded", { ready: 3, total: 3 }, [...AWS_STAGES], "pods"), 1);
});
