import assert from "node:assert/strict";
import { test } from "node:test";

import type { PodInfo } from "@/types/cluster.ts";
import { explainPod } from "@/services/failureExplainer.ts";

function pod(overrides: Partial<PodInfo>): PodInfo {
  return {
    name: "sample-app-abc",
    phase: "Running",
    ready: true,
    restarts: 0,
    image: "sample-app:v2",
    createdAt: new Date("2026-10-12T10:00:00Z"),
    containers: [],
    ...overrides,
  };
}

test("a healthy pod needs no explanation", () => {
  assert.equal(explainPod(pod({}), []), null);
});

test("a pod that is still starting needs no explanation", () => {
  const starting = pod({ phase: "Pending", ready: false, waitingReason: "ContainerCreating" });

  assert.equal(explainPod(starting, []), null);
});

for (const reason of ["ImagePullBackOff", "ErrImagePull", "InvalidImageName"]) {
  test(`${reason} is explained as an image that was not found`, () => {
    const failing = pod({ phase: "Pending", ready: false, image: "sample-app:v9", waitingReason: reason });

    assert.equal(
      explainPod(failing, []),
      "Image sample-app:v9 was not found, or the cluster is not allowed to pull it.",
    );
  });
}

test("a crash loop quotes the last log line", () => {
  const crashing = pod({
    ready: false,
    restarts: 4,
    waitingReason: "CrashLoopBackOff",
    lastTerminationReason: "Error",
    lastExitCode: 1,
  });

  assert.equal(
    explainPod(crashing, ["starting", "Fatal: cannot read /etc/app/config.json"]),
    'Container keeps crashing (4 restarts, exit code 1). Last log line: "Fatal: cannot read /etc/app/config.json".',
  );
});

test("a crash loop without any log output still says what is happening", () => {
  const crashing = pod({ ready: false, restarts: 1, waitingReason: "CrashLoopBackOff", lastExitCode: 137 });

  assert.equal(explainPod(crashing, []), "Container keeps crashing (1 restart, exit code 137).");
});

test("an OOMKilled pod is explained in plain words, even when it is running again", () => {
  const killed = pod({ restarts: 2, lastTerminationReason: "OOMKilled", lastExitCode: 137 });

  assert.equal(
    explainPod(killed, []),
    "Killed for using more memory than its limit (OOMKilled); restarted 2 times.",
  );
});

test("a pod that does not fit on any node says which resource is short", () => {
  const noMemory = pod({
    phase: "Pending",
    ready: false,
    unschedulableMessage: "0/2 nodes are available: 2 Insufficient memory. preemption: 0/2 nodes are available",
  });
  const noCpu = pod({ phase: "Pending", ready: false, unschedulableMessage: "0/1 nodes are available: 1 Insufficient cpu." });

  assert.equal(explainPod(noMemory, []), "Pending: not enough memory on the nodes.");
  assert.equal(explainPod(noCpu, []), "Pending: not enough CPU on the nodes.");
});

test("any other scheduling problem passes on the scheduler's own words", () => {
  const tainted = pod({ phase: "Pending", ready: false, unschedulableMessage: "0/1 nodes are available: 1 node(s) had untolerated taint." });

  assert.equal(explainPod(tainted, []), "Pending: 0/1 nodes are available: 1 node(s) had untolerated taint.");
});

test("a container that cannot be created passes on Kubernetes' reason", () => {
  const broken = pod({
    phase: "Pending",
    ready: false,
    waitingReason: "CreateContainerConfigError",
    waitingMessage: 'secret "db" not found',
  });

  assert.equal(explainPod(broken, []), 'Cannot start (CreateContainerConfigError): secret "db" not found.');
});

test("a pod that restarted for another reason reports the last exit", () => {
  const restarted = pod({ restarts: 1, lastTerminationReason: "Error", lastExitCode: 2 });

  assert.equal(explainPod(restarted, []), "Restarted 1 time; last exit: Error (exit code 2).");
});

test("a running pod that is not ready is explained by its last warning event", () => {
  const notReady = pod({ ready: false });
  const events = [
    { type: "Normal", reason: "Started", message: "Started container sample-app", at: null },
    { type: "Warning", reason: "Unhealthy", message: "Readiness probe failed: HTTP probe failed with statuscode: 500", at: null },
  ];

  assert.equal(
    explainPod(notReady, [], events),
    "Not ready: Readiness probe failed: HTTP probe failed with statuscode: 500.",
  );
});
