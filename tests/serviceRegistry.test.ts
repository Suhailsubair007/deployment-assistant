import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { loadConfig } from "@/config.ts";
import { InvalidRequestError } from "@/errors.ts";
import { ServiceRegistry } from "@/services/serviceRegistry.ts";
import type { ServiceSpec } from "@/types/service.ts";

const config = loadConfig("config/app.config.yaml");

/** A registry that lives in memory, so tests leave no file behind. */
function newRegistry(): ServiceRegistry {
  return new ServiceRegistry({ path: ":memory:", cluster: "kind-test", config });
}

function ordersApi(overrides: Partial<ServiceSpec> = {}): ServiceSpec {
  return {
    name: "orders-api",
    environment: "staging",
    imageRepository: "orders-api",
    folder: "/Users/asha/code/orders-api",
    port: 3000,
    healthPath: "/healthz",
    replicas: 2,
    maxReplicas: 5,
    resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "256Mi" } },
    env: [{ name: "NODE_ENV", value: "production" }],
    lastVersion: 1,
    ...overrides,
  };
}

test("an app from the config file is a service in every environment", () => {
  const registry = newRegistry();

  for (const environment of ["staging", "prod"]) {
    const spec = registry.find(environment, "sample-app");

    assert.equal(spec?.environment, environment);
    assert.equal(spec?.imageRepository, "sample-app");
    assert.equal(spec?.port, 8080);
    assert.equal(spec?.maxReplicas, 10);
    assert.equal(spec?.resources.limits.memory, "256Mi");
  }
});

test("an app from the config file has no folder, no variables, and is checked on /health", () => {
  const spec = newRegistry().find("staging", "sample-app");

  assert.equal(spec?.folder, null);
  assert.deepEqual(spec?.env, []);
  assert.equal(spec?.healthPath, "/health");
  assert.equal(spec?.lastVersion, 0);
});

test("a saved service comes back exactly as it was saved", () => {
  const registry = newRegistry();

  registry.save(ordersApi());

  assert.deepEqual(registry.find("staging", "orders-api"), ordersApi());
});

test("a saved service exists only in the environment it was saved for", () => {
  const registry = newRegistry();

  registry.save(ordersApi());

  assert.equal(registry.find("prod", "orders-api"), null);
});

test("saving a service again replaces its settings", () => {
  const registry = newRegistry();
  registry.save(ordersApi());

  registry.save(ordersApi({ replicas: 4, lastVersion: 2 }));

  assert.equal(registry.find("staging", "orders-api")?.replicas, 4);
  assert.equal(registry.find("staging", "orders-api")?.lastVersion, 2);
  assert.equal(registry.list("staging").filter((spec) => spec.name === "orders-api").length, 1);
});

test("a service saved on one cluster is not seen from another cluster", () => {
  const file = join(mkdtempSync(join(tmpdir(), "registry-")), "assistant.db");
  const kind = new ServiceRegistry({ path: file, cluster: "kind-local", config });
  const eks = new ServiceRegistry({ path: file, cluster: "eks-staging", config });

  kind.save(ordersApi());

  assert.equal(eks.find("staging", "orders-api"), null);
  assert.equal(kind.find("staging", "orders-api")?.name, "orders-api");
});

test("saved settings for a config app replace the config values in that environment only", () => {
  const registry = newRegistry();
  const edited = { ...registry.find("staging", "sample-app")!, env: [{ name: "GREETING", value: "hi" }] };

  registry.save(edited);

  assert.deepEqual(registry.find("staging", "sample-app")?.env, [{ name: "GREETING", value: "hi" }]);
  assert.deepEqual(registry.find("prod", "sample-app")?.env, []);
});

test("the services of an environment are the config apps and the saved ones", () => {
  const registry = newRegistry();
  registry.save(ordersApi());

  assert.deepEqual(registry.list("staging").map((spec) => spec.name), ["sample-app", "orders-api"]);
  assert.deepEqual(registry.list("prod").map((spec) => spec.name), ["sample-app"]);
});

test("every service name is listed once, whatever the environment", () => {
  const registry = newRegistry();
  registry.save(ordersApi());
  registry.save(ordersApi({ environment: "prod" }));

  assert.deepEqual(registry.names(), ["sample-app", "orders-api"]);
});

test("resolving a service gives its settings and the namespace of its environment", () => {
  const registry = newRegistry();
  registry.save(ordersApi({ environment: "prod" }));

  const { namespace, spec } = registry.resolve("prod", "orders-api");

  assert.equal(namespace, "prod");
  assert.equal(spec.port, 3000);
});

test("resolving an unknown environment names the ones that exist", () => {
  assert.throws(
    () => newRegistry().resolve("qa", "sample-app"),
    (error: unknown) =>
      error instanceof InvalidRequestError &&
      error.message === 'There is no environment called "qa". I know: staging, prod.',
  );
});

test("resolving an unknown service names the ones that exist in that environment", () => {
  const registry = newRegistry();
  registry.save(ordersApi());

  assert.throws(
    () => registry.resolve("staging", "billing"),
    (error: unknown) =>
      error instanceof InvalidRequestError &&
      error.message === 'I don\'t know an app called "billing". I know: sample-app, orders-api.',
  );
});
