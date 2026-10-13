import assert from "node:assert/strict";
import { test } from "node:test";

import { buildRolloutSteps, currentStep } from "@/lib/rollout-steps.ts";

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

test("the headline of a running or failed change is the pods step", () => {
  assert.equal(currentStep(buildRolloutSteps("running", null))?.id, "pods");
  assert.equal(currentStep(buildRolloutSteps("failed", { ready: 0, total: 3 }))?.id, "pods");
});

test("the headline of a change that succeeded is the last step", () => {
  assert.equal(currentStep(buildRolloutSteps("succeeded", { ready: 3, total: 3 }))?.id, "finished");
});

test("the headline of a change the page lost contact with is the last step known to be done", () => {
  assert.equal(currentStep(buildRolloutSteps("unknown", null))?.id, "sent");
});

// A change that builds an image goes through more stages than the pods.

const LOCAL_STAGES = ["build", "publish", "pods"] as const;
const AWS_STAGES = ["repository", "build", "publish", "pods"] as const;

test("a change that builds an image has one step per stage, between the same first and last step", () => {
  assert.deepEqual(
    buildRolloutSteps("running", null, [...LOCAL_STAGES], "build").map((step) => step.id),
    ["sent", "build", "publish", "pods", "finished"],
  );
  assert.deepEqual(
    buildRolloutSteps("running", null, [...AWS_STAGES], "repository").map((step) => step.id),
    ["sent", "repository", "build", "publish", "pods", "finished"],
  );
});

test("while the image is built, the build step is active and the later ones wait", () => {
  const steps = buildRolloutSteps("running", null, [...LOCAL_STAGES], "build");

  assert.deepEqual(statesOf(steps), ["done", "active", "pending", "pending", "pending"]);
  assert.equal(currentStep(steps)?.title, "Building the image");
});

test("on AWS the first stage prepares the image repository", () => {
  const steps = buildRolloutSteps("running", null, [...AWS_STAGES], "repository");

  assert.deepEqual(statesOf(steps), ["done", "active", "pending", "pending", "pending", "pending"]);
  assert.equal(currentStep(steps)?.title, "Preparing the image repository");
});

test("the stages before the one that is running are done", () => {
  const steps = buildRolloutSteps("running", null, [...AWS_STAGES], "publish");

  assert.deepEqual(statesOf(steps), ["done", "done", "done", "active", "pending", "pending"]);
  assert.equal(currentStep(steps)?.title, "Uploading the image");
});

test("the build and the upload say that they can take long, but only while they run", () => {
  const steps = buildRolloutSteps("running", null, [...LOCAL_STAGES], "publish");

  assert.equal(steps[1]?.detail, "");
  assert.equal(steps[2]?.detail, "This can take a few minutes");
  assert.equal(currentStep(buildRolloutSteps("running", null, [...LOCAL_STAGES], "build"))?.detail, "This can take a few minutes");
});

test("the repository step has no line next to its name, which already fills the row", () => {
  assert.equal(currentStep(buildRolloutSteps("running", null, [...AWS_STAGES], "repository"))?.detail, "");
});

test("before the pods stage, nothing says it is waiting for the first pod", () => {
  const steps = buildRolloutSteps("running", null, [...LOCAL_STAGES], "build");

  assert.equal(steps[3]?.id, "pods");
  assert.equal(steps[3]?.detail, "");
});

test("in the pods stage, the pods step is the one a change always had", () => {
  const steps = buildRolloutSteps("running", { ready: 2, total: 3 }, [...LOCAL_STAGES], "pods");

  assert.deepEqual(statesOf(steps), ["done", "done", "done", "active", "pending"]);
  assert.deepEqual(currentStep(steps), buildRolloutSteps("running", { ready: 2, total: 3 })[1]);
  assert.equal(currentStep(steps)?.detail, "2 of 3 ready");
});

test("in the pods stage, before the first count arrives, the pods step says it is waiting", () => {
  const steps = buildRolloutSteps("running", null, [...LOCAL_STAGES], "pods");

  assert.equal(currentStep(steps)?.detail, "Waiting for the first pod");
});

test("a build that failed stops at the build step, and nothing after it is done", () => {
  const steps = buildRolloutSteps("failed", null, [...LOCAL_STAGES], "build");

  assert.deepEqual(statesOf(steps), ["done", "failed", "pending", "pending", "pending"]);
  assert.equal(currentStep(steps)?.id, "build");
  assert.equal(currentStep(steps)?.detail, "");
});

test("a change that built an image and succeeded has every step done", () => {
  const steps = buildRolloutSteps("succeeded", { ready: 3, total: 3 }, [...AWS_STAGES], "pods");

  assert.deepEqual(statesOf(steps), ["done", "done", "done", "done", "done", "done"]);
  assert.equal(currentStep(steps)?.id, "finished");
});

test("a build the page lost contact with shows the last stage known to be done", () => {
  const steps = buildRolloutSteps("unknown", null, [...LOCAL_STAGES], "publish");

  assert.deepEqual(statesOf(steps), ["done", "done", "pending", "pending", "pending"]);
  assert.equal(currentStep(steps)?.id, "build");
});

test("without stages a change is exactly the three steps it always was", () => {
  assert.deepEqual(buildRolloutSteps("running", { ready: 1, total: 3 }, undefined, undefined), [
    { id: "sent", title: "Change sent to the cluster", detail: "", state: "done" },
    { id: "pods", title: "Starting the pods", detail: "1 of 3 ready", state: "active" },
    { id: "finished", title: "Rollout finished", detail: "", state: "pending" },
  ]);
});
