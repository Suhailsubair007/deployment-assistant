import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ConfigError, loadConfig, thresholdsFor } from "../src/config.ts";

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
