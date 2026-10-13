import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { DEFAULT_HEALTH_PATH, SERVICES_SCHEMA } from "@/constants/service.ts";
import { InvalidRequestError } from "@/errors.ts";
import type { AppConfig } from "@/types/config.ts";
import type { ResolvedService, ServiceRegistryDeps, ServiceSpec } from "@/types/service.ts";

/**
 * The services of one cluster. A service is either an app from the config file, which
 * exists in every environment, or one that was created from the chat and saved here.
 */
export class ServiceRegistry {
  private readonly db: DatabaseSync;
  private readonly cluster: string;
  private readonly config: AppConfig;

  constructor(deps: ServiceRegistryDeps) {
    if (deps.path !== ":memory:") {
      mkdirSync(dirname(deps.path), { recursive: true });
    }
    this.db = new DatabaseSync(deps.path);
    this.cluster = deps.cluster;
    this.config = deps.config;
    this.db.exec(SERVICES_SCHEMA);
  }

  /** The service's settings, or null when there is no such service in this environment. */
  find(environment: string, name: string): ServiceSpec | null {
    const row = this.db
      .prepare("SELECT spec FROM services WHERE cluster = ? AND environment = ? AND name = ?")
      .get(this.cluster, environment, name);
    if (row !== undefined) {
      return JSON.parse(String(row.spec)) as ServiceSpec;
    }
    return this.fromConfig(environment, name);
  }

  /** The Kubernetes namespace of an environment. Throws InvalidRequestError, naming the known ones, when there is none. */
  namespaceOf(environment: string): string {
    if (!Object.hasOwn(this.config.environments, environment)) {
      const known = Object.keys(this.config.environments).join(", ");
      throw new InvalidRequestError(`There is no environment called "${environment}". I know: ${known}.`);
    }
    return this.config.environments[environment].namespace;
  }

  /** Throws InvalidRequestError, naming what is known, when the environment or the service does not exist. */
  resolve(environment: string, name: string): ResolvedService {
    const namespace = this.namespaceOf(environment);
    const spec = this.find(environment, name);
    if (spec === null) {
      const known = this.list(environment).map((service) => service.name).join(", ");
      throw new InvalidRequestError(`I don't know an app called "${name}". I know: ${known}.`);
    }
    return { namespace, spec };
  }

  /** The services of one environment: the config apps first, then the saved ones, oldest first. */
  list(environment: string): ServiceSpec[] {
    const saved = this.db
      .prepare("SELECT spec FROM services WHERE cluster = ? AND environment = ? ORDER BY rowid")
      .all(this.cluster, environment)
      .map((row) => JSON.parse(String(row.spec)) as ServiceSpec);

    const services: ServiceSpec[] = [];
    for (const name of Object.keys(this.config.apps)) {
      // Saved settings for a config app take the place of the config values.
      const fromConfig = this.fromConfig(environment, name);
      const service = saved.find((spec) => spec.name === name) ?? fromConfig;
      if (service !== null) {
        services.push(service);
      }
    }
    return [...services, ...saved.filter((spec) => !Object.hasOwn(this.config.apps, spec.name))];
  }

  /** Every service name of this cluster, once each. */
  names(): string[] {
    const saved = this.db
      .prepare("SELECT name FROM services WHERE cluster = ? GROUP BY name ORDER BY MIN(rowid)")
      .all(this.cluster)
      .map((row) => String(row.name));
    return [...new Set([...Object.keys(this.config.apps), ...saved])];
  }

  /** Stores the settings, replacing what was stored for this service in this environment. */
  save(spec: ServiceSpec): void {
    this.db
      .prepare(
        `INSERT INTO services (cluster, environment, name, spec, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (cluster, environment, name)
         DO UPDATE SET spec = excluded.spec, updated_at = excluded.updated_at`,
      )
      .run(this.cluster, spec.environment, spec.name, JSON.stringify(spec), new Date().toISOString());
  }

  /**
   * The number for the next image built for this service. Every environment of a cluster
   * uses the same image repository, so the highest number in any of them counts.
   */
  nextVersion(name: string): number {
    const builds = this.db
      .prepare("SELECT spec FROM services WHERE cluster = ? AND name = ?")
      .all(this.cluster, name)
      .map((row) => (JSON.parse(String(row.spec)) as ServiceSpec).lastVersion);
    return Math.max(0, ...builds) + 1;
  }

  private fromConfig(environment: string, name: string): ServiceSpec | null {
    if (!Object.hasOwn(this.config.apps, name) || !Object.hasOwn(this.config.environments, environment)) {
      return null;
    }
    return {
      ...this.config.apps[name],
      name,
      environment,
      folder: null,
      healthPath: DEFAULT_HEALTH_PATH,
      env: [],
      lastVersion: 0,
    };
  }
}
