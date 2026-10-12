import assert from "node:assert/strict";
import { test } from "node:test";

import { toAppError } from "../src/cluster/kubeErrors.ts";
import { AppError, ClusterUnreachableError, ForbiddenError, NotFoundError } from "../src/errors.ts";

/** An error shaped like the one the Kubernetes library throws for a non-2xx answer. */
function apiError(code: number, body: unknown): Error {
  return Object.assign(new Error("HTTP-Code: " + code), { code, body });
}

/** An error shaped like the one Node's fetch throws when the server cannot be reached. */
function networkError(code: string): Error {
  const cause = Object.assign(new Error(`connect ${code} 127.0.0.1:6443`), { code });
  return Object.assign(new TypeError("fetch failed"), { cause });
}

const where = { action: "read the deployment", namespace: "staging", context: "kind-deploy-assistant" };

test("a 404 for a deployment becomes NotFoundError that names it", () => {
  const error = toAppError(
    apiError(404, {
      kind: "Status",
      message: 'deployments.apps "sample-app" not found',
      details: { name: "sample-app", kind: "deployments" },
    }),
    where,
  );

  assert.ok(error instanceof NotFoundError);
  assert.equal(error.message, 'Deployment "sample-app" was not found in namespace staging.');
  assert.equal(error.kind, "deployments");
});

test("a 404 for a namespace says the namespace does not exist", () => {
  const error = toAppError(
    apiError(404, {
      kind: "Status",
      message: 'namespaces "qa" not found',
      details: { name: "qa", kind: "namespaces" },
    }),
    { ...where, namespace: "qa" },
  );

  assert.ok(error instanceof NotFoundError);
  assert.equal(error.message, 'Namespace "qa" does not exist in this cluster.');
});

test("a 404 whose body arrives as text is still understood", () => {
  const body = JSON.stringify({ details: { name: "sample-app", kind: "services" } });

  const error = toAppError(apiError(404, body), where);

  assert.equal(error.message, 'Service "sample-app" was not found in namespace staging.');
});

test("a 403 becomes ForbiddenError that says what was not allowed and where", () => {
  const kubernetesMessage =
    'deployments.apps "sample-app" is forbidden: User "assistant" cannot update resource "deployments" in API group "apps" in the namespace "prod"';

  const error = toAppError(apiError(403, { kind: "Status", message: kubernetesMessage }), {
    action: "update the deployment",
    namespace: "prod",
    context: "eks",
  });

  assert.ok(error instanceof ForbiddenError);
  assert.equal(
    error.message,
    `The assistant is not allowed to update the deployment in namespace prod. Kubernetes said: ${kubernetesMessage}`,
  );
});

for (const code of ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"]) {
  test(`a network failure (${code}) becomes ClusterUnreachableError`, () => {
    const error = toAppError(networkError(code), where);

    assert.ok(error instanceof ClusterUnreachableError);
    assert.equal(
      error.message,
      'I can\'t reach the cluster (context "kind-deploy-assistant"). Check that it is running and that your kubeconfig context is right.',
    );
  });
}

test("a 401 says the credentials were rejected", () => {
  const error = toAppError(apiError(401, { message: "Unauthorized" }), where);

  assert.ok(error instanceof ClusterUnreachableError);
  assert.equal(
    error.message,
    'The cluster rejected the credentials for context "kind-deploy-assistant". Refresh them and try again.',
  );
});

test("any other Kubernetes answer is passed on with Kubernetes' own explanation", () => {
  const error = toAppError(
    apiError(422, { message: 'Deployment.apps "sample-app" is invalid: spec.replicas: Invalid value: -1' }),
    { action: "update the deployment", namespace: "staging", context: "kind" },
  );

  assert.ok(error instanceof AppError);
  assert.equal(
    error.message,
    'Kubernetes refused to update the deployment: Deployment.apps "sample-app" is invalid: spec.replicas: Invalid value: -1',
  );
});

test("an error that did not come from Kubernetes is returned unchanged", () => {
  const bug = new RangeError("index out of range");

  assert.equal(toAppError(bug, where), bug);
});
