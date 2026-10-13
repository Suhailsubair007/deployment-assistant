import type { WizardField } from "@/types/wizard.ts";

// ---- The project folder ----

/** The file a project folder must contain. */
export const DOCKERFILE_NAME = "Dockerfile";

// A line such as "EXPOSE 3000" or "expose 3000/tcp" in a Dockerfile. The number is the port.
export const EXPOSE_PATTERN = /^\s*EXPOSE\s+(\d+)/im;

// ---- The rules for the answers ----

export const MAX_NAME_LENGTH = 40;

// Lowercase letters, digits and dashes, starting with a letter and ending with a letter or a digit.
export const SERVICE_NAME_PATTERN = /^[a-z]([a-z0-9-]*[a-z0-9])?$/;

// Ports below 1024 need special rights inside the container, so the app may not use them.
export const LOWEST_PORT = 1024;
export const HIGHEST_PORT = 65535;

export const MAX_HEALTH_PATH_LENGTH = 100;

/** The most copies a service may run, and the most it may be scaled to. */
export const MAX_COPIES = 50;

export const MAX_VARIABLES = 20;

// A whole number written with digits only: "3000", not "3e3" or "-1".
export const WHOLE_NUMBER_PATTERN = /^\d+$/;

// What may stand between the reserved amount and the maximum: "to", a dash, a comma or spaces.
export const AMOUNT_SEPARATOR = /\s+to\s+|[\s,-]+/i;

// A full stop, exclamation mark or question mark at the end of an answer, as in "prod." or "staging?".
export const TRAILING_PUNCTUATION = /[.!?]+$/;

// ---- The words the user can type ----

export const CANCEL_WORD = "cancel";
export const DEFAULT_WORD = "default";
export const NO_VARIABLES_WORD = "none";

// The questions asked when a service is created, in this order.
export const CREATE_ORDER: WizardField[] = [
  "folder",
  "name",
  "environment",
  "port",
  "healthPath",
  "cpu",
  "memory",
  "replicas",
  "maxReplicas",
  "variables",
];

// The settings that can be changed later, each with the name the user sees for it.
export const EDITABLE_SETTINGS: [field: WizardField, label: string][] = [
  ["cpu", "cpu"],
  ["memory", "memory"],
  ["port", "port"],
  ["healthPath", "health path"],
  ["variables", "variables"],
  ["maxReplicas", "max replicas"],
];

// Every word that picks a setting to change, with the setting it picks.
export const SETTING_WORDS: Record<string, WizardField> = {
  cpu: "cpu",
  memory: "memory",
  ram: "memory",
  port: "port",
  "health path": "healthPath",
  health: "healthPath",
  healthpath: "healthPath",
  variables: "variables",
  env: "variables",
  "max replicas": "maxReplicas",
  max: "maxReplicas",
  maxreplicas: "maxReplicas",
};

// ---- The questions ----

/** The first line of the first reply. */
export const INTRO = "I'll ask one thing at a time. Type cancel to stop, or default to take the suggested value.";

// The environment question and the list of settings are not here: they name things, so the functions below build them.
export const QUESTIONS: Record<Exclude<WizardField, "environment" | "change">, string> = {
  folder:
    "Where is the project folder? Give the full path, for example ~/code/orders-api. It must contain a Dockerfile.",
  name: "What should the service be called?",
  port: "Which port does the app listen on?",
  healthPath: "Which path answers the health check? It must return 200 when the app is ready.",
  cpu: "How much CPU for each copy? Give the reserved amount and the maximum, for example 100m to 500m (1000m is one core). One amount sets both.",
  memory:
    "How much memory for each copy? Give the reserved amount and the maximum, for example 128Mi to 256Mi. One amount sets both. A copy that goes over the maximum is restarted.",
  replicas: "How many copies should run?",
  maxReplicas: "What is the most it may be scaled to? This is only a limit for the scale command.",
  variables:
    "Any environment variables? Type them as NAME=value, separated by spaces, for example NODE_ENV=production LOG_LEVEL=info. Type none to skip. They are stored and shown as plain text, so do not put passwords or keys here.",
};

/** "Which environment: staging or prod?" */
export function environmentQuestion(environments: string[]): string {
  return `Which environment: ${environments.join(" or ")}?`;
}

/** The line under a question that shows what "default" stands for. */
export function defaultLine(value: string): string {
  return `Default: ${value}`;
}

/** Added to the default port when it was read from the project's Dockerfile. */
export const FROM_DOCKERFILE = " (from the Dockerfile)";

/** The line under a question that shows the value a setting has now. */
export function nowLine(value: string): string {
  return `Now: ${value}`;
}

/** Shown with the variables question when a service is edited. */
export const VARIABLES_ARE_REPLACED = "Your answer replaces the whole list, and none removes them all.";

/** The first line of the list of settings. */
export function editHeadline(name: string, environment: string): string {
  return `What do you want to change in ${name} (${environment})?`;
}

/** The last line of the list of settings. */
export function editChoices(name: string, environment: string): string {
  const labels = EDITABLE_SETTINGS.map(([, label]) => label).join(", ");
  return `Type one of: ${labels}. To change the number of copies, type: scale ${name} in ${environment} to 3.`;
}

// ---- The replies that end the questions ----

export const CREATE_CANCELLED = "Cancelled. Nothing was created.";
export const EDIT_CANCELLED = "Cancelled. Nothing was changed.";

// ---- What is said about an answer that cannot be used ----

export const NO_DEFAULT = "There is no default for this one.";

export const BAD_NAME = `A name uses lowercase letters, digits and dashes. It starts with a letter, ends with a letter or a digit, and is at most ${MAX_NAME_LENGTH} characters long.`;

/** The name is taken in the environment the user just named. */
export function nameTaken(name: string, environment: string): string {
  return `There is already a service called ${name} in ${environment}. Name another environment, or type cancel and start again with another name.`;
}

/** The name is taken in the environment that was named before the questions started. */
export function nameTakenThere(name: string, environment: string): string {
  return `There is already a service called ${name} in ${environment}. Give another name.`;
}

export const UNKNOWN_ENVIRONMENT = "I don't know that environment.";

export const BAD_PORT = `The port must be a whole number from ${LOWEST_PORT} to ${HIGHEST_PORT}.`;

export const BAD_HEALTH_PATH = `The path must start with / and use only letters, digits and the characters / . _ ~ and -. It can be at most ${MAX_HEALTH_PATH_LENGTH} characters long.`;

export const BAD_CPU = "I need one CPU amount or two, for example 250m or 100m to 500m.";

export const BAD_MEMORY = "I need one memory amount or two, for example 256Mi or 128Mi to 256Mi.";

// A number without a unit is easy to type by mistake: "128" is 128 bytes of memory, and "500" is 500 whole cores.
// Both would give a service that can never start, so the smallest memory and the largest CPU are limited.
export const LEAST_MEMORY_BYTES = 8 * 1024 * 1024;
export const MOST_CPU_MILLICORES = 16_000;

export function tooLittleMemory(amount: string): string {
  return `${amount} is far too little memory for an app to start. A number without a unit means bytes: add a unit, for example ${amount}Mi.`;
}

export function tooMuchCpu(amount: string): string {
  return `${amount} means ${amount} whole cores, which is more than I allow (${MOST_CPU_MILLICORES / 1000}). For a part of a core add m, for example ${amount}m (1000m is one core).`;
}

export const RESERVED_ABOVE_MAXIMUM = "The reserved amount cannot be larger than the maximum. Give the smaller amount first.";

export const BAD_REPLICAS = `The number of copies must be a whole number from 1 to ${MAX_COPIES}.`;

export function badMaxReplicas(lowest: number): string {
  return `The limit must be a whole number from ${lowest} to ${MAX_COPIES}.`;
}

export const BAD_VARIABLES =
  "I need NAME=value pieces separated by spaces, for example LOG_LEVEL=info. A value cannot contain spaces.";

export function badVariableName(name: string): string {
  return `${name} cannot be used as a name. A name uses letters, digits and underscores, and does not start with a digit.`;
}

export function duplicateVariable(name: string): string {
  return `${name} is in the list twice. Give each name once.`;
}

export const TOO_MANY_VARIABLES = `That is more than ${MAX_VARIABLES} variables. Give ${MAX_VARIABLES} at most.`;

export const UNKNOWN_SETTING = "I don't know that setting.";
