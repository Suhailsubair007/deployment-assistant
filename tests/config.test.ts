import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

import { ConfigError, loadConfig, thresholdsFor } from "@/config.ts";

const SHIPPED_CONFIG = "config/app.config.yaml";

/** Writes a config file into a fresh temp folder and returns its path. */
function writeTempConfig(yamlText: string): string {
  const folder = mkdtempSync(join(tmpdir(), "assistant-config-"));
  const path = join(folder, "app.config.yaml");
  writeFileSync(path, yamlText);
  return path;
}

const VALID_CONFIG = `
environments:
  staging: { namespace: staging }
  prod: { namespace: prod, protected: true }
apps:
  sample-app:
    imageRepository: sample-app
    port: 8080
    replicas: 3
    maxReplicas: 10
    resources:
      requests: { cpu: 100m, memory: 128Mi }
      limits: { cpu: 500m, memory: 256Mi }
timeouts: { rolloutSeconds: 180, healthRequestMs: 3000, pollIntervalMs: 2000 }
thresholds:
  default:
    memoryPercentOfLimit: 85
    cpuPercentOfLimit: 90
    restartCount: 3
    oomKillWindowMinutes: 30
    healthResponseMs: 1000
    pendingSeconds: 60
  overrides:
    prod: { memoryPercentOfLimit: 70 }
`;

test("the shipped config file loads with staging and a protected prod", () => {
  const config = loadConfig(SHIPPED_CONFIG);

  assert.deepEqual(Object.keys(config.environments), ["staging", "prod"]);
  assert.equal(config.environments.staging.protected, false);
  assert.equal(config.environments.prod.protected, true);
  assert.equal(config.apps["sample-app"].resources.limits.memory, "256Mi");
  assert.equal(config.apps["sample-app"].maxReplicas, 10);
  assert.equal(config.timeouts.rolloutSeconds, 180);
});

test("an environment without an override gets the default thresholds", () => {
  const config = loadConfig(writeTempConfig(VALID_CONFIG));

  assert.equal(thresholdsFor(config, "staging").memoryPercentOfLimit, 85);
});

test("a prod override replaces only the value it names", () => {
  const config = loadConfig(writeTempConfig(VALID_CONFIG));

  const prod = thresholdsFor(config, "prod");

  assert.equal(prod.memoryPercentOfLimit, 70);
  assert.equal(prod.cpuPercentOfLimit, 90);
});

test("asking for thresholds of an unknown environment names the known ones", () => {
  const config = loadConfig(writeTempConfig(VALID_CONFIG));

  assert.throws(
    () => thresholdsFor(config, "qa"),
    new ConfigError('Unknown environment "qa". Known environments: staging, prod.'),
  );
});

test("a missing config file gives a clear error", () => {
  assert.throws(
    () => loadConfig("config/does-not-exist.yaml"),
    new ConfigError("Config file not found: config/does-not-exist.yaml"),
  );
});

test("a threshold that is not a positive number is rejected by name", () => {
  const broken = VALID_CONFIG.replace("memoryPercentOfLimit: 85", "memoryPercentOfLimit: high");

  assert.throws(
    () => loadConfig(writeTempConfig(broken)),
    new ConfigError("Config error: thresholds.default.memoryPercentOfLimit must be a positive number."),
  );
});

test("an override for an environment that does not exist is rejected", () => {
  const broken = VALID_CONFIG.replace("prod: { memoryPercentOfLimit: 70 }", "qa: { memoryPercentOfLimit: 70 }");

  assert.throws(
    () => loadConfig(writeTempConfig(broken)),
    new ConfigError('Config error: thresholds.overrides names "qa", which is not an environment.'),
  );
});

// ---- The llm section ----

test("the shipped config file names the OpenAI model, its timeout and the pause after a failure", () => {
  const config = loadConfig(SHIPPED_CONFIG);

  assert.deepEqual(config.llm, { model: "gpt-4.1-mini", requestTimeoutMs: 8000, retryAfterSeconds: 60 });
});

test("a config file without an llm section still loads, with the default llm settings", () => {
  const config = loadConfig(writeTempConfig(VALID_CONFIG));

  assert.deepEqual(config.llm, { model: "gpt-4.1-mini", requestTimeoutMs: 8000, retryAfterSeconds: 60 });
});

test("an llm section may set only some values; the others keep their defaults", () => {
  const config = loadConfig(writeTempConfig(`${VALID_CONFIG}\nllm: { model: some-other-model }\n`));

  assert.deepEqual(config.llm, { model: "some-other-model", requestTimeoutMs: 8000, retryAfterSeconds: 60 });
});

test("an llm timeout that is not a positive number is rejected by name", () => {
  const broken = `${VALID_CONFIG}\nllm: { requestTimeoutMs: soon }\n`;

  assert.throws(
    () => loadConfig(writeTempConfig(broken)),
    new ConfigError("Config error: llm.requestTimeoutMs must be a positive number."),
  );
});

// ---- The serviceDefaults section ----

const BUILT_IN_SERVICE_DEFAULTS = {
  port: 8080,
  healthPath: "/health",
  replicas: 2,
  maxReplicas: 10,
  resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "256Mi" } },
};

test("the shipped config file writes out the serviceDefaults and build sections", () => {
  const written = parse(readFileSync(SHIPPED_CONFIG, "utf8"));

  assert.deepEqual(Object.keys(written.serviceDefaults), ["port", "healthPath", "replicas", "maxReplicas", "resources"]);
  assert.deepEqual(Object.keys(written.build), ["allowedRoots", "timeoutSeconds"]);
});

test("the shipped config file gives the default answers for a new service", () => {
  const config = loadConfig(SHIPPED_CONFIG);

  assert.deepEqual(config.serviceDefaults, BUILT_IN_SERVICE_DEFAULTS);
});

test("a config file without a serviceDefaults section still loads, with the built-in default answers", () => {
  const config = loadConfig(writeTempConfig(VALID_CONFIG));

  assert.deepEqual(config.serviceDefaults, BUILT_IN_SERVICE_DEFAULTS);
});

test("a serviceDefaults section may set only some values; the others keep their defaults", () => {
  const partial = `${VALID_CONFIG}\nserviceDefaults: { port: 3000, resources: { limits: { cpu: "1", memory: 512Mi } } }\n`;

  const config = loadConfig(writeTempConfig(partial));

  assert.deepEqual(config.serviceDefaults, {
    ...BUILT_IN_SERVICE_DEFAULTS,
    port: 3000,
    resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "1", memory: "512Mi" } },
  });
});

test("a default port that is not a positive number is rejected by name", () => {
  const broken = `${VALID_CONFIG}\nserviceDefaults: { port: web }\n`;

  assert.throws(
    () => loadConfig(writeTempConfig(broken)),
    new ConfigError("Config error: serviceDefaults.port must be a positive number."),
  );
});

test("a default health path that is not text is rejected by name", () => {
  const broken = `${VALID_CONFIG}\nserviceDefaults: { healthPath: 200 }\n`;

  assert.throws(
    () => loadConfig(writeTempConfig(broken)),
    new ConfigError("Config error: serviceDefaults.healthPath must be text."),
  );
});

test("a default amount of memory that is missing is rejected by name", () => {
  const broken = `${VALID_CONFIG}\nserviceDefaults: { resources: { requests: { cpu: 100m } } }\n`;

  assert.throws(
    () => loadConfig(writeTempConfig(broken)),
    new ConfigError("Config error: serviceDefaults.resources.requests.memory must be text."),
  );
});

// ---- The build section ----

test("the shipped config file builds only inside the home folder and gives a build 15 minutes", () => {
  const config = loadConfig(SHIPPED_CONFIG);

  assert.deepEqual(config.build, { allowedRoots: ["~"], timeoutSeconds: 900 });
});

test("a config file without a build section still loads, with the built-in build settings", () => {
  const config = loadConfig(writeTempConfig(VALID_CONFIG));

  assert.deepEqual(config.build, { allowedRoots: ["~"], timeoutSeconds: 900 });
});

test("a build section may name its own folders and keep the default timeout", () => {
  const config = loadConfig(writeTempConfig(`${VALID_CONFIG}\nbuild: { allowedRoots: ["~/code", /srv/projects] }\n`));

  assert.deepEqual(config.build, { allowedRoots: ["~/code", "/srv/projects"], timeoutSeconds: 900 });
});

const notListsOfFolders: [what: string, yaml: string][] = [
  ["one folder that is not in a list", "~/code"],
  ["an empty list", "[]"],
  ["a list with a number in it", "[~/code, 5]"],
];
for (const [what, yaml] of notListsOfFolders) {
  test(`build.allowedRoots given as ${what} is rejected by name`, () => {
    const broken = `${VALID_CONFIG}\nbuild: { allowedRoots: ${yaml} }\n`;

    assert.throws(
      () => loadConfig(writeTempConfig(broken)),
      new ConfigError("Config error: build.allowedRoots must be a list of folders."),
    );
  });
}

test("a build timeout that is not a positive number is rejected by name", () => {
  const broken = `${VALID_CONFIG}\nbuild: { timeoutSeconds: 0 }\n`;

  assert.throws(
    () => loadConfig(writeTempConfig(broken)),
    new ConfigError("Config error: build.timeoutSeconds must be a positive number."),
  );
});
