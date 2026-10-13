import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

import { APP_NAME_PATTERN, IMAGE_REPOSITORY_PATTERN, SERVICE_PORT, IMAGE_TAG_PATTERN, TEMPLATE_FOLDER } from "@/constants/deployment.ts";
import { DEFAULT_HEALTH_PATH, ENV_NAME_PATTERN, HEALTH_PATH_PATTERN } from "@/constants/service.ts";
import { InvalidRequestError } from "@/errors.ts";
import { parseCpuToMillicores, parseMemoryToBytes } from "@/services/units.ts";
import type { Manifest } from "@/types/cluster.ts";
import type { ResourceAmounts } from "@/types/config.ts";
import type { DeployParams } from "@/types/deployment.ts";
import type { EnvVar } from "@/types/service.ts";

/** Splits "registry:5000/app:v2" into the repository and the version after the last colon. */
function splitImage(image: string): { repository: string; tag: string | null } {
  // A colon before the last slash belongs to the registry port, not to the version.
  const colon = image.indexOf(":", image.lastIndexOf("/") + 1);
  if (colon === -1) {
    return { repository: image, tag: null };
  }
  return { repository: image.slice(0, colon), tag: image.slice(colon + 1) };
}

function checkImage(image: string): void {
  const { repository, tag } = splitImage(image);
  if (tag === null || tag === "") {
    throw new InvalidRequestError(`Image "${image}" has no version. Name one, for example ${repository}:v2.`);
  }
  if (tag === "latest") {
    throw new InvalidRequestError(
      `I don't deploy the "latest" tag, because nobody can tell which version it is. Name a version, for example ${repository}:v2.`,
    );
  }
  if (!IMAGE_TAG_PATTERN.test(tag)) {
    throw new InvalidRequestError(
      `"${tag}" is not a valid image version. Use letters, digits, dots, dashes and underscores.`,
    );
  }
  if (!IMAGE_REPOSITORY_PATTERN.test(repository)) {
    throw new InvalidRequestError(`"${repository}" is not a valid image name.`);
  }
}

function checkQuantities(amounts: ResourceAmounts): void {
  try {
    parseCpuToMillicores(amounts.cpu);
    parseMemoryToBytes(amounts.memory);
  } catch {
    throw new InvalidRequestError(
      `CPU "${amounts.cpu}" and memory "${amounts.memory}" must be amounts Kubernetes understands, for example 250m and 128Mi.`,
    );
  }
}

function checkParams(params: DeployParams): void {
  if (!APP_NAME_PATTERN.test(params.name)) {
    throw new InvalidRequestError(`"${params.name}" is not a valid app name.`);
  }
  checkImage(params.image);
  if (!Number.isInteger(params.replicas) || params.replicas < 0) {
    throw new InvalidRequestError(`Replicas must be a whole number, 0 or more. I got ${params.replicas}.`);
  }
  if (!Number.isInteger(params.port) || params.port < 1 || params.port > 65535) {
    throw new InvalidRequestError(`Port must be a whole number from 1 to 65535. I got ${params.port}.`);
  }
  checkQuantities(params.resources.requests);
  checkQuantities(params.resources.limits);
  if (params.healthPath !== undefined && !HEALTH_PATH_PATTERN.test(params.healthPath)) {
    throw new InvalidRequestError(
      `"${params.healthPath}" is not a valid health check path. It starts with "/" and has no spaces, for example /health.`,
    );
  }
  for (const variable of params.env ?? []) {
    if (!ENV_NAME_PATTERN.test(variable.name)) {
      throw new InvalidRequestError(
        `"${variable.name}" is not a valid variable name. Use letters, digits and underscores, not starting with a digit.`,
      );
    }
  }
}

/** Replaces every {{key}} in the template with its value, then reads the result as YAML. */
function render(templateFile: string, values: Record<string, string | number>): Manifest {
  const template = readFileSync(join(TEMPLATE_FOLDER, templateFile), "utf8");
  const text = template.replace(/\{\{(\w+)\}\}/g, (_placeholder, key: string) => {
    const value = values[key];
    if (value === undefined) {
      // A template asking for a value we do not supply is a programming mistake.
      throw new Error(`Template ${templateFile} uses {{${key}}}, which has no value.`);
    }
    return String(value);
  });
  return parse(text) as Manifest;
}

/**
 * Puts the variables on the container. They are set on the finished object, not pasted
 * into the template text, because a value may hold any character at all.
 */
function addVariables(deployment: Manifest, env: EnvVar[]): void {
  if (env.length === 0) {
    return;
  }
  const spec = deployment.spec as { template: { spec: { containers: Record<string, unknown>[] } } };
  spec.template.spec.containers[0].env = env.map(({ name, value }) => ({ name, value }));
}

/** Throws InvalidRequestError when a value is not acceptable. */
export function buildManifests(params: DeployParams): { deployment: Manifest; service: Manifest } {
  checkParams(params);

  const values = {
    name: params.name,
    image: params.image,
    replicas: params.replicas,
    port: params.port,
    servicePort: SERVICE_PORT,
    healthPath: params.healthPath ?? DEFAULT_HEALTH_PATH,
    cpuRequest: params.resources.requests.cpu,
    memoryRequest: params.resources.requests.memory,
    cpuLimit: params.resources.limits.cpu,
    memoryLimit: params.resources.limits.memory,
  };
  const deployment = render("deployment.yaml", values);
  addVariables(deployment, params.env ?? []);
  return { deployment, service: render("service.yaml", values) };
}
