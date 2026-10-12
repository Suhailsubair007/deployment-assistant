import assert from "node:assert/strict";
import { test } from "node:test";

import { toUserError } from "../src/api/errorMapper.ts";
import { ConfigError } from "../src/config.ts";
import {
  AppError,
  ClusterUnreachableError,
  DeployInProgressError,
  ForbiddenError,
  InvalidRequestError,
  MetricsUnavailableError,
  NotFoundError,
} from "../src/errors.ts";

const noLog = (): void => {};

const cases: [error: Error, status: number][] = [
  [new InvalidRequestError("Image has no version."), 400],
  [new ForbiddenError("The assistant is not allowed to update the deployment in namespace prod."), 403],
  [new NotFoundError('Namespace "qa" does not exist in this cluster.', "namespaces"), 404],
  [new DeployInProgressError("staging already has a deployment in progress."), 409],
  [new ClusterUnreachableError("I can't reach the cluster."), 503],
  [new MetricsUnavailableError("metrics-server is not installed."), 503],
  [new AppError("Kubernetes refused to update the deployment: invalid value"), 400],
  [new ConfigError("Config file not found: config/app.config.yaml"), 500],
];

for (const [error, status] of cases) {
  test(`${error.name} keeps its own message and becomes HTTP ${status}`, () => {
    assert.deepEqual(toUserError(error, noLog), { status, message: error.message });
  });
}

test("an unexpected error shows a reference instead of its details", () => {
  const bug = new TypeError("Cannot read properties of undefined (reading 'spec')");

  const result = toUserError(bug, noLog);

  assert.equal(result.status, 500);
  assert.match(result.message, /^Something went wrong on the server \(reference [0-9a-f]{8}\)\. The details are in the server log\.$/);
  assert.ok(!result.message.includes("spec"));
});

test("the details of an unexpected error go to the server log with the same reference", () => {
  const logged: unknown[][] = [];
  const bug = new Error("boom");

  const result = toUserError(bug, (...parts: unknown[]) => logged.push(parts));

  const reference = /reference ([0-9a-f]{8})/.exec(result.message)?.[1];
  assert.equal(logged.length, 1);
  assert.ok(String(logged[0]?.[0]).includes(reference ?? "no reference found"));
  assert.equal(logged[0]?.[1], bug);
});

test("a request body that is not valid JSON is the caller's mistake, not a server error", () => {
  const parseFailure = Object.assign(new SyntaxError("Unexpected token"), { type: "entity.parse.failed", status: 400 });

  assert.deepEqual(toUserError(parseFailure, noLog), { status: 400, message: "The request body is not valid JSON." });
});
