import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";

/** When an app counts as DEGRADED. Every value comes from the config file. */
export interface Thresholds {
  memoryPercentOfLimit: number;
  cpuPercentOfLimit: number;
  restartCount: number;
  oomKillWindowMinutes: number;
  healthResponseMs: number;
  pendingSeconds: number;
}

export interface EnvironmentConfig {
  namespace: string;
  /** Protected environments (prod) show an extra warning before a change. */
  protected: boolean;
}

/** CPU and memory as Kubernetes writes them, for example "100m" and "128Mi". */
export interface ResourceAmounts {
  cpu: string;
  memory: string;
}

export interface AppDefaults {
  imageRepository: string;
  port: number;
  replicas: number;
  resources: { requests: ResourceAmounts; limits: ResourceAmounts };
}

export interface Timeouts {
  rolloutSeconds: number;
  healthRequestMs: number;
  pollIntervalMs: number;
}

export interface AppConfig {
  environments: Record<string, EnvironmentConfig>;
  apps: Record<string, AppDefaults>;
  timeouts: Timeouts;
  thresholds: { default: Thresholds; overrides: Record<string, Partial<Thresholds>> };
}

/** A problem with the config file, written so the person editing it can fix it. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const THRESHOLD_KEYS: (keyof Thresholds)[] = [
  "memoryPercentOfLimit",
  "cpuPercentOfLimit",
  "restartCount",
  "oomKillWindowMinutes",
  "healthResponseMs",
  "pendingSeconds",
];

type Section = Record<string, unknown>;

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
