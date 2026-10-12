// Builds the Deployment and Service the assistant sends to Kubernetes, from the
// templates in k8s/templates. Every value is checked before it goes into a template,
// so nothing a user types can change the shape of the manifest.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

import type { Manifest } from "../cluster/gateway.ts";
import type { ResourceAmounts } from "../config.ts";
import { InvalidRequestError } from "../errors.ts";
import { parseCpuToMillicores, parseMemoryToBytes } from "./units.ts";

/** The port of the Service. The Service forwards it to the app's own port. */
export const SERVICE_PORT = 80;

const TEMPLATE_FOLDER = join(import.meta.dirname, "../../k8s/templates");

export interface DeployParams {
  /** Name of the app; used for the Deployment, the Service and the "app" label. */
  name: string;
  /** Full image with version, for example "sample-app:v2". */
  image: string;
  replicas: number;
  /** Port the app listens on inside the container. */
  port: number;
  resources: { requests: ResourceAmounts; limits: ResourceAmounts };
}

// Kubernetes names: lowercase letters, digits and dashes, at most 63 characters.
const NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
// Image repository, optionally with a registry: "sample-app", "localhost:5000/team/sample-app".
const REPOSITORY = /^[a-z0-9]+(?:[._\-/:][a-z0-9]+)*$/;
// Image version (tag): "v2", "1.4.0", "2026-10-12_build7".
const TAG = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

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
  if (!TAG.test(tag)) {
    throw new InvalidRequestError(
      `"${tag}" is not a valid image version. Use letters, digits, dots, dashes and underscores.`,
    );
  }
  if (!REPOSITORY.test(repository)) {
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
  if (!NAME.test(params.name)) {
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

/** Throws InvalidRequestError when a value is not acceptable. */
export function buildManifests(params: DeployParams): { deployment: Manifest; service: Manifest } {
  checkParams(params);

  const values = {
    name: params.name,
    image: params.image,
    replicas: params.replicas,
    port: params.port,
    servicePort: SERVICE_PORT,
    cpuRequest: params.resources.requests.cpu,
    memoryRequest: params.resources.requests.memory,
    cpuLimit: params.resources.limits.cpu,
    memoryLimit: params.resources.limits.memory,
  };
  return {
    deployment: render("deployment.yaml", values),
    service: render("service.yaml", values),
  };
}
