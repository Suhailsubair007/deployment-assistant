import assert from "node:assert/strict";
import { test } from "node:test";

import { InvalidRequestError } from "@/errors.ts";
import { SERVICE_PORT } from "@/constants/deployment.ts";
import { buildManifests } from "@/services/manifestBuilder.ts";
import type { DeployParams } from "@/types/deployment.ts";

const params: DeployParams = {
  name: "sample-app",
  image: "sample-app:v2",
  replicas: 3,
  port: 8080,
  resources: {
    requests: { cpu: "100m", memory: "128Mi" },
    limits: { cpu: "500m", memory: "256Mi" },
  },
};

/** Reads a nested value by path, for example at(manifest, "spec.ports.0.port"). */
function at(value: unknown, path: string): unknown {
  let current = value;
  for (const key of path.split(".")) {
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

const CONTAINER = "spec.template.spec.containers.0";

test("the deployment carries the image, replicas, port and resources it was given", () => {
  const { deployment } = buildManifests(params);

  assert.equal(at(deployment, "kind"), "Deployment");
  assert.equal(at(deployment, "metadata.name"), "sample-app");
  assert.equal(at(deployment, "spec.replicas"), 3);
  assert.equal(at(deployment, `${CONTAINER}.image`), "sample-app:v2");
  assert.equal(at(deployment, `${CONTAINER}.ports.0.containerPort`), 8080);
  assert.deepEqual(at(deployment, `${CONTAINER}.resources`), {
    requests: { cpu: "100m", memory: "128Mi" },
    limits: { cpu: "500m", memory: "256Mi" },
  });
});

test("the deployment selects exactly the pods it creates", () => {
  const { deployment } = buildManifests(params);

  assert.equal(at(deployment, "spec.selector.matchLabels.app"), "sample-app");
  assert.equal(at(deployment, "spec.template.metadata.labels.app"), "sample-app");
});

test("readiness and liveness probes both call /health on the app port", () => {
  const { deployment } = buildManifests(params);

  assert.deepEqual(at(deployment, `${CONTAINER}.readinessProbe.httpGet`), { path: "/health", port: 8080 });
  assert.deepEqual(at(deployment, `${CONTAINER}.livenessProbe.httpGet`), { path: "/health", port: 8080 });
});

test("the service sends its port to the app port of the same pods", () => {
  const { service } = buildManifests(params);

  assert.equal(at(service, "kind"), "Service");
  assert.equal(at(service, "metadata.name"), "sample-app");
  assert.equal(at(service, "spec.selector.app"), "sample-app");
  assert.equal(at(service, "spec.ports.0.port"), SERVICE_PORT);
  assert.equal(at(service, "spec.ports.0.targetPort"), 8080);
});

test("an image from a registry with a port keeps its full name", () => {
  const { deployment } = buildManifests({ ...params, image: "localhost:5000/team/sample-app:v2" });

  assert.equal(at(deployment, `${CONTAINER}.image`), "localhost:5000/team/sample-app:v2");
});

test("an image without a version is refused", () => {
  assert.throws(
    () => buildManifests({ ...params, image: "sample-app" }),
    new InvalidRequestError('Image "sample-app" has no version. Name one, for example sample-app:v2.'),
  );
});

test('the "latest" tag is refused', () => {
  assert.throws(
    () => buildManifests({ ...params, image: "sample-app:latest" }),
    new InvalidRequestError(
      'I don\'t deploy the "latest" tag, because nobody can tell which version it is. Name a version, for example sample-app:v2.',
    ),
  );
});

test("a version with characters that could break the manifest is refused", () => {
  assert.throws(
    () => buildManifests({ ...params, image: 'sample-app:v2"\n  evil: true' }),
    InvalidRequestError,
  );
});

test("replicas must be a whole number that is not negative", () => {
  assert.throws(
    () => buildManifests({ ...params, replicas: -1 }),
    new InvalidRequestError("Replicas must be a whole number, 0 or more. I got -1."),
  );
  assert.throws(() => buildManifests({ ...params, replicas: 2.5 }), InvalidRequestError);
});

test("a resource amount Kubernetes would not understand is refused", () => {
  const broken = { ...params.resources, limits: { cpu: "500m", memory: "lots" } };

  assert.throws(() => buildManifests({ ...params, resources: broken }), InvalidRequestError);
});

// ---- Settings of a service created from the chat ----

test("a service with its own health path is probed on that path", () => {
  const { deployment } = buildManifests({ ...params, port: 3000, healthPath: "/api/healthz" });

  assert.deepEqual(at(deployment, `${CONTAINER}.readinessProbe.httpGet`), { path: "/api/healthz", port: 3000 });
  assert.deepEqual(at(deployment, `${CONTAINER}.livenessProbe.httpGet`), { path: "/api/healthz", port: 3000 });
});

test("a health path that could break the manifest is refused", () => {
  for (const healthPath of ["health", "/he alth", '/health"\nfoo: bar', ""]) {
    assert.throws(() => buildManifests({ ...params, healthPath }), InvalidRequestError, `path "${healthPath}"`);
  }
});

test("variables are handed to the container in the order they were given", () => {
  const env = [
    { name: "NODE_ENV", value: "production" },
    { name: "LOG_LEVEL", value: "info" },
  ];

  const { deployment } = buildManifests({ ...params, env });

  assert.deepEqual(at(deployment, `${CONTAINER}.env`), env);
});

test("a variable's value is carried exactly, whatever characters it holds", () => {
  const awkward = 'say "hi" to {{name}}: yes\nsecond line # not a comment';

  const { deployment } = buildManifests({ ...params, env: [{ name: "GREETING", value: awkward }] });

  assert.equal(at(deployment, `${CONTAINER}.env.0.value`), awkward);
  // The rest of the manifest is untouched by it.
  assert.equal(at(deployment, "metadata.name"), "sample-app");
});

test("a deployment without variables has no env section", () => {
  const { deployment } = buildManifests(params);

  assert.equal(at(deployment, `${CONTAINER}.env`), undefined);
});

test("a variable name the shell could not use is refused", () => {
  for (const name of ["2FAST", "MY-VAR", "has space", ""]) {
    assert.throws(
      () => buildManifests({ ...params, env: [{ name, value: "x" }] }),
      (error: unknown) => error instanceof InvalidRequestError && error.message.includes("not a valid variable name"),
      `name "${name}"`,
    );
  }
});
