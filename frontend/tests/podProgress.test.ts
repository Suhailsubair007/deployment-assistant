import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePodProgress } from "../lib/pod-progress.ts";

test("reads the ready and wanted pod counts from a progress step", () => {
  assert.deepEqual(parsePodProgress("2/3 pods ready"), { ready: 2, total: 3 });
});

test("reads a step where no pod is ready yet", () => {
  assert.deepEqual(parsePodProgress("0/5 pods ready"), { ready: 0, total: 5 });
});

test("reads counts of more than one digit", () => {
  assert.deepEqual(parsePodProgress("10/10 pods ready"), { ready: 10, total: 10 });
});

test("reads the counts from any step that starts with them", () => {
  assert.deepEqual(parsePodProgress("1/4 pods updated"), { ready: 1, total: 4 });
});

test("a step without pod counts gives null", () => {
  assert.equal(parsePodProgress("Waiting for the first pod..."), null);
});
