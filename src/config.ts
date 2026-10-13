import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";

import { BUILD_DEFAULTS, LLM_DEFAULTS, SERVICE_DEFAULTS, THRESHOLD_KEYS } from "@/constants/config.ts";
import type {
  AppConfig,
  AppDefaults,
  BuildSettings,
  EnvironmentConfig,
  LlmSettings,
  ResourceAmounts,
  Section,
  ServiceDefaults,
  Thresholds,
  Timeouts,
} from "@/types/config.ts";

/** A problem with the config file, written so the person editing it can fix it. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function fail(problem: string): never {
  throw new ConfigError(`Config error: ${problem}`);
}

/** Returns `value` as a section (a YAML mapping), or fails naming where it should be. */
function asSection(value: unknown, path: string): Section {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${path} must be a section with settings.`);
  }
  return value as Section;
}

function readNumber(parent: Section, key: string, path: string): number {
  const value = parent[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail(`${path}.${key} must be a positive number.`);
  }
  return value;
}

function readText(parent: Section, key: string, path: string): string {
  const value = parent[key];
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${path}.${key} must be text.`);
  }
  return value;
}

function readEnvironments(section: Section): Record<string, EnvironmentConfig> {
  const environments: Record<string, EnvironmentConfig> = {};
  for (const [name, value] of Object.entries(section)) {
    const path = `environments.${name}`;
    const settings = asSection(value, path);
    environments[name] = {
      namespace: readText(settings, "namespace", path),
      protected: settings.protected === true,
    };
  }
  if (Object.keys(environments).length === 0) {
    fail("environments must name at least one environment.");
  }
  return environments;
}

function readResourceAmounts(parent: Section, key: string, path: string): ResourceAmounts {
  const amounts = asSection(parent[key], `${path}.${key}`);
  return {
    cpu: readText(amounts, "cpu", `${path}.${key}`),
    memory: readText(amounts, "memory", `${path}.${key}`),
  };
}

function readApps(section: Section): Record<string, AppDefaults> {
  const apps: Record<string, AppDefaults> = {};
  for (const [name, value] of Object.entries(section)) {
    const path = `apps.${name}`;
    const settings = asSection(value, path);
    const resources = asSection(settings.resources, `${path}.resources`);
    apps[name] = {
      imageRepository: readText(settings, "imageRepository", path),
      port: readNumber(settings, "port", path),
      replicas: readNumber(settings, "replicas", path),
      maxReplicas: readNumber(settings, "maxReplicas", path),
      resources: {
        requests: readResourceAmounts(resources, "requests", `${path}.resources`),
        limits: readResourceAmounts(resources, "limits", `${path}.resources`),
      },
    };
  }
  return apps;
}

function readTimeouts(section: Section): Timeouts {
  return {
    rolloutSeconds: readNumber(section, "rolloutSeconds", "timeouts"),
    healthRequestMs: readNumber(section, "healthRequestMs", "timeouts"),
    pollIntervalMs: readNumber(section, "pollIntervalMs", "timeouts"),
  };
}

function readDefaultThresholds(section: Section): Thresholds {
  const path = "thresholds.default";
  return {
    memoryPercentOfLimit: readNumber(section, "memoryPercentOfLimit", path),
    cpuPercentOfLimit: readNumber(section, "cpuPercentOfLimit", path),
    restartCount: readNumber(section, "restartCount", path),
    oomKillWindowMinutes: readNumber(section, "oomKillWindowMinutes", path),
    healthResponseMs: readNumber(section, "healthResponseMs", path),
    pendingSeconds: readNumber(section, "pendingSeconds", path),
  };
}

function readThresholdOverrides(
  section: Section,
  environmentNames: string[],
): Record<string, Partial<Thresholds>> {
  const overrides: Record<string, Partial<Thresholds>> = {};
  for (const [environment, value] of Object.entries(section)) {
    if (!environmentNames.includes(environment)) {
      fail(`thresholds.overrides names "${environment}", which is not an environment.`);
    }
    const path = `thresholds.overrides.${environment}`;
    const settings = asSection(value, path);
    const override: Partial<Thresholds> = {};
    for (const key of Object.keys(settings)) {
      const thresholdKey = THRESHOLD_KEYS.find((known) => known === key);
      if (thresholdKey === undefined) {
        fail(`${path}.${key} is not a known threshold.`);
      }
      override[thresholdKey] = readNumber(settings, key, path);
    }
    overrides[environment] = override;
  }
  return overrides;
}

function readLlm(section: Section): LlmSettings {
  return {
    model: section.model === undefined ? LLM_DEFAULTS.model : readText(section, "model", "llm"),
    requestTimeoutMs:
      section.requestTimeoutMs === undefined
        ? LLM_DEFAULTS.requestTimeoutMs
        : readNumber(section, "requestTimeoutMs", "llm"),
    retryAfterSeconds:
      section.retryAfterSeconds === undefined
        ? LLM_DEFAULTS.retryAfterSeconds
        : readNumber(section, "retryAfterSeconds", "llm"),
  };
}

/** Every value is optional: one that is left out keeps its built-in default. */
function readServiceDefaults(section: Section): ServiceDefaults {
  const path = "serviceDefaults";
  const resources = asSection(section.resources ?? {}, `${path}.resources`);
  return {
    port: section.port === undefined ? SERVICE_DEFAULTS.port : readNumber(section, "port", path),
    healthPath:
      section.healthPath === undefined ? SERVICE_DEFAULTS.healthPath : readText(section, "healthPath", path),
    replicas: section.replicas === undefined ? SERVICE_DEFAULTS.replicas : readNumber(section, "replicas", path),
    maxReplicas:
      section.maxReplicas === undefined ? SERVICE_DEFAULTS.maxReplicas : readNumber(section, "maxReplicas", path),
    resources: {
      requests:
        resources.requests === undefined
          ? SERVICE_DEFAULTS.resources.requests
          : readResourceAmounts(resources, "requests", `${path}.resources`),
      limits:
        resources.limits === undefined
          ? SERVICE_DEFAULTS.resources.limits
          : readResourceAmounts(resources, "limits", `${path}.resources`),
    },
  };
}

/** Returns the value as a list of folder paths, or fails naming where it should be. */
function readFolders(parent: Section, key: string, path: string): string[] {
  const value = parent[key];
  if (!Array.isArray(value) || value.length === 0) {
    fail(`${path}.${key} must be a list of folders.`);
  }
  const folders: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      fail(`${path}.${key} must be a list of folders.`);
    }
    folders.push(item);
  }
  return folders;
}

function readBuild(section: Section): BuildSettings {
  return {
    allowedRoots:
      section.allowedRoots === undefined ? BUILD_DEFAULTS.allowedRoots : readFolders(section, "allowedRoots", "build"),
    timeoutSeconds:
      section.timeoutSeconds === undefined
        ? BUILD_DEFAULTS.timeoutSeconds
        : readNumber(section, "timeoutSeconds", "build"),
  };
}

/** Reads and checks the config file. Throws ConfigError with a message the editor can act on. */
export function loadConfig(path: string): AppConfig {
  if (!existsSync(path)) {
    throw new ConfigError(`Config file not found: ${path}`);
  }
  const root = asSection(parse(readFileSync(path, "utf8")), "The config file");
  const environments = readEnvironments(asSection(root.environments, "environments"));
  const thresholds = asSection(root.thresholds, "thresholds");

  return {
    environments,
    apps: readApps(asSection(root.apps, "apps")),
    timeouts: readTimeouts(asSection(root.timeouts, "timeouts")),
    thresholds: {
      default: readDefaultThresholds(asSection(thresholds.default, "thresholds.default")),
      // The overrides section is optional.
      overrides: readThresholdOverrides(
        asSection(thresholds.overrides ?? {}, "thresholds.overrides"),
        Object.keys(environments),
      ),
    },
    // The llm section is optional.
    llm: readLlm(asSection(root.llm ?? {}, "llm")),
    // So are these two: a service can be created from the chat without them.
    serviceDefaults: readServiceDefaults(asSection(root.serviceDefaults ?? {}, "serviceDefaults")),
    build: readBuild(asSection(root.build ?? {}, "build")),
  };
}

/** The thresholds for one environment: the defaults, with that environment's overrides on top. */
export function thresholdsFor(config: AppConfig, environment: string): Thresholds {
  if (!Object.hasOwn(config.environments, environment)) {
    const known = Object.keys(config.environments).join(", ");
    throw new ConfigError(`Unknown environment "${environment}". Known environments: ${known}.`);
  }
  return { ...config.thresholds.default, ...config.thresholds.overrides[environment] };
}
