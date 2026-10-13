/**
 * The questions that create a service, or change one setting of a service, in the chat.
 *
 * Nothing here reads a file or the cluster: what the questions need from outside is
 * handed in as the WizardContext. Each function takes the state it is given and returns
 * a new one, so the same answers always lead to the same result.
 */
import { findEnvironment } from "@/agent/intentParser.ts";
import { ENV_NAME_PATTERN, HEALTH_PATH_PATTERN } from "@/constants/service.ts";
import {
  AMOUNT_SEPARATOR,
  BAD_CPU,
  BAD_HEALTH_PATH,
  BAD_MEMORY,
  BAD_NAME,
  BAD_PORT,
  BAD_REPLICAS,
  BAD_VARIABLES,
  CANCEL_WORD,
  CREATE_CANCELLED,
  CREATE_ORDER,
  DEFAULT_WORD,
  EDITABLE_SETTINGS,
  EDIT_CANCELLED,
  FROM_DOCKERFILE,
  HIGHEST_PORT,
  INTRO,
  LOWEST_PORT,
  MAX_COPIES,
  MAX_HEALTH_PATH_LENGTH,
  MAX_NAME_LENGTH,
  MAX_VARIABLES,
  NO_DEFAULT,
  NO_VARIABLES_WORD,
  QUESTIONS,
  RESERVED_ABOVE_MAXIMUM,
  SERVICE_NAME_PATTERN,
  SETTING_WORDS,
  TOO_MANY_VARIABLES,
  TRAILING_PUNCTUATION,
  UNKNOWN_ENVIRONMENT,
  UNKNOWN_SETTING,
  VARIABLES_ARE_REPLACED,
  WHOLE_NUMBER_PATTERN,
  badMaxReplicas,
  badVariableName,
  defaultLine,
  duplicateVariable,
  editChoices,
  editHeadline,
  environmentQuestion,
  LEAST_MEMORY_BYTES,
  MOST_CPU_MILLICORES,
  tooLittleMemory,
  tooMuchCpu,
  nameTaken,
  nameTakenThere,
  nowLine,
} from "@/constants/wizard.ts";
import { InvalidRequestError } from "@/errors.ts";
import { parseCpuToMillicores, parseMemoryToBytes } from "@/services/units.ts";
import type { EnvVar, ServiceSpec } from "@/types/service.ts";
import type { ServiceDraft, Wizard, WizardContext, WizardField, WizardStep } from "@/types/wizard.ts";

/** A value that an earlier step has stored. It is only missing when the code itself is wrong. */
function stored<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error("The service questions are missing an earlier answer.");
  }
  return value;
}

// ---- What a question shows ----

/** The port named in the project's Dockerfile. Null when there is none, or the app may not use it. */
function dockerfilePort(draft: ServiceDraft): number | null {
  const port = draft.project?.port ?? null;
  if (port === null || port < LOWEST_PORT || port > HIGHEST_PORT) {
    return null;
  }
  return port;
}

/** What "default" stands for at this question of a create. Null when the question has no default. */
function defaultAnswer(wizard: Wizard, context: WizardContext): string | null {
  const { draft } = wizard;
  const { defaults } = context;
  switch (wizard.field) {
    case "name":
      return draft.project?.suggestedName ?? null;
    case "port":
      return String(dockerfilePort(draft) ?? defaults.port);
    case "healthPath":
      return defaults.healthPath;
    case "cpu":
      return `${defaults.resources.requests.cpu} to ${defaults.resources.limits.cpu}`;
    case "memory":
      return `${defaults.resources.requests.memory} to ${defaults.resources.limits.memory}`;
    case "replicas":
      return String(defaults.replicas);
    case "maxReplicas":
      // The limit can never be below the number of copies that was just chosen.
      return String(Math.max(defaults.maxReplicas, draft.replicas ?? 1));
    case "variables":
      return NO_VARIABLES_WORD;
    default:
      // The folder, the environment and the list of settings have no default.
      return null;
  }
}

/** The value a setting of the service has now, written the way the user would type it. */
function currentValue(spec: ServiceSpec, field: WizardField): string {
  switch (field) {
    case "cpu":
      return `${spec.resources.requests.cpu} to ${spec.resources.limits.cpu}`;
    case "memory":
      return `${spec.resources.requests.memory} to ${spec.resources.limits.memory}`;
    case "port":
      return String(spec.port);
    case "healthPath":
      return spec.healthPath;
    case "maxReplicas":
      return String(spec.maxReplicas);
    case "variables":
      if (spec.env.length === 0) {
        return NO_VARIABLES_WORD;
      }
      return spec.env.map((variable) => `${variable.name}=${variable.value}`).join(" ");
    default:
      // The other answers cannot be changed here.
      return "";
  }
}

/** The first question of an edit: the settings as they are now, and the words that pick one. */
function settingsList(spec: ServiceSpec): string {
  // The table shows only the names of the variables, which keeps that row short.
  const variableNames = spec.env.length === 0 ? NO_VARIABLES_WORD : spec.env.map((variable) => variable.name).join(", ");

  // The page draws lines with " | " that follow each other as one table.
  const rows = EDITABLE_SETTINGS.map(([field, label]) => {
    const value = field === "variables" ? variableNames : currentValue(spec, field);
    return `${label} | ${value}`;
  });
  return [editHeadline(spec.name, spec.environment), ...rows, editChoices(spec.name, spec.environment)].join("\n");
}

/** The question the wizard is waiting on, with its default (create) or the value now (edit). */
function questionFor(wizard: Wizard, context: WizardContext): string {
  const { field } = wizard;
  if (field === "change") {
    return settingsList(stored(wizard.original));
  }
  const lines = [field === "environment" ? environmentQuestion(context.environments) : QUESTIONS[field]];

  if (wizard.kind === "edit") {
    if (field === "variables") {
      lines.push(VARIABLES_ARE_REPLACED);
    }
    lines.push(nowLine(currentValue(stored(wizard.original), field)));
    return lines.join("\n");
  }

  const suggested = defaultAnswer(wizard, context);
  if (suggested !== null) {
    const fromDockerfile = field === "port" && dockerfilePort(wizard.draft) !== null;
    lines.push(defaultLine(suggested) + (fromDockerfile ? FROM_DOCKERFILE : ""));
  }
  return lines.join("\n");
}

/** Asks the question the wizard is waiting on. */
function ask(wizard: Wizard, context: WizardContext): WizardStep {
  const question = questionFor(wizard, context);
  return { kind: "ask", wizard, text: question, question };
}

/** Says what was wrong with the answer and asks the same question again. */
function askAgain(wizard: Wizard, problem: string, context: WizardContext): WizardStep {
  const question = questionFor(wizard, context);
  return { kind: "ask", wizard, text: `${problem}\n${question}`, question, rejected: true };
}

// ---- Checking one answer ----
// Each function returns the value to store, or throws InvalidRequestError with a sentence for the user.

function readName(text: string, draft: ServiceDraft, context: WizardContext): string {
  if (text.length > MAX_NAME_LENGTH || !SERVICE_NAME_PATTERN.test(text)) {
    throw new InvalidRequestError(BAD_NAME);
  }
  // The environment is only known this early when it was named before the questions started.
  if (draft.environment !== undefined && context.exists(draft.environment, text)) {
    throw new InvalidRequestError(nameTakenThere(text, draft.environment));
  }
  return text;
}

function readEnvironment(text: string, draft: ServiceDraft, context: WizardContext): string {
  // "prod." and "Prod?" are the answer "prod".
  const word = text.toLowerCase().replace(TRAILING_PUNCTUATION, "").trim();
  // The answer must be the environment alone. A sentence that only mentions one, such as
  // "deploy v2 to staging", is another request and not an answer to this question.
  if (/\s/.test(word)) {
    throw new InvalidRequestError(UNKNOWN_ENVIRONMENT);
  }
  // The same reading as everywhere in the chat: "production" and "stagin" are understood too.
  const environment = findEnvironment(word, context.environments);
  if (environment === undefined) {
    throw new InvalidRequestError(UNKNOWN_ENVIRONMENT);
  }
  const name = stored(draft.name);
  if (context.exists(environment, name)) {
    throw new InvalidRequestError(nameTaken(name, environment));
  }
  return environment;
}

/** Reads a whole number from `lowest` to `highest`. `problem` is the sentence for anything else. */
function readWholeNumber(text: string, lowest: number, highest: number, problem: string): number {
  if (!WHOLE_NUMBER_PATTERN.test(text)) {
    throw new InvalidRequestError(problem);
  }
  const value = Number(text);
  if (value < lowest || value > highest) {
    throw new InvalidRequestError(problem);
  }
  return value;
}

function readHealthPath(text: string): string {
  if (text.length > MAX_HEALTH_PATH_LENGTH || !HEALTH_PATH_PATTERN.test(text)) {
    throw new InvalidRequestError(BAD_HEALTH_PATH);
  }
  return text;
}

/** True when `toNumber` can read the amount and it is more than zero. */
function isAmount(text: string, toNumber: (amount: string) => number): boolean {
  try {
    return toNumber(text) > 0;
  } catch {
    return false;
  }
}

/**
 * Reads "100m to 500m" as the reserved amount and the maximum. One amount stands for both.
 * The amounts are returned as they were typed, because that is how Kubernetes wants them.
 *
 * @param toNumber turns an amount into a number that can be compared; it throws on text it cannot read
 * @param problem the sentence for an answer that is not one or two amounts
 */
function readAmounts(
  text: string,
  toNumber: (amount: string) => number,
  problem: string,
): { reserved: string; maximum: string } {
  const amounts = text.split(AMOUNT_SEPARATOR).filter((amount) => amount !== "");
  if (amounts.length !== 1 && amounts.length !== 2) {
    throw new InvalidRequestError(problem);
  }
  const reserved = amounts[0];
  const maximum = amounts.length === 2 ? amounts[1] : reserved;
  if (!isAmount(reserved, toNumber) || !isAmount(maximum, toNumber)) {
    throw new InvalidRequestError(problem);
  }
  if (toNumber(reserved) > toNumber(maximum)) {
    throw new InvalidRequestError(RESERVED_ABOVE_MAXIMUM);
  }
  return { reserved, maximum };
}

/** Reads "NODE_ENV=production LOG_LEVEL=info". The word "none" means no variables. */
function readVariables(text: string): EnvVar[] {
  if (text.toLowerCase() === NO_VARIABLES_WORD) {
    return [];
  }
  const variables: EnvVar[] = [];
  for (const piece of text.split(/\s+/)) {
    // The name is everything before the first "=", the value everything after it.
    const equalsAt = piece.indexOf("=");
    if (equalsAt < 1) {
      // There is no "=", or nothing in front of it.
      throw new InvalidRequestError(BAD_VARIABLES);
    }
    const name = piece.slice(0, equalsAt);
    const value = piece.slice(equalsAt + 1);
    if (!ENV_NAME_PATTERN.test(name)) {
      throw new InvalidRequestError(badVariableName(name));
    }
    if (variables.some((variable) => variable.name === name)) {
      throw new InvalidRequestError(duplicateVariable(name));
    }
    variables.push({ name, value });
  }
  if (variables.length > MAX_VARIABLES) {
    throw new InvalidRequestError(TOO_MANY_VARIABLES);
  }
  return variables;
}

/** Checks the answer to one question and returns a copy of the draft with the answer in it. */
function storeAnswer(
  draft: ServiceDraft,
  field: Exclude<WizardField, "change">,
  answer: string,
  context: WizardContext,
): ServiceDraft {
  switch (field) {
    case "folder": {
      const project = context.inspect(answer);
      return { ...draft, folder: project.folder, project };
    }
    case "name":
      return { ...draft, name: readName(answer, draft, context) };
    case "environment":
      return { ...draft, environment: readEnvironment(answer, draft, context) };
    case "port":
      return { ...draft, port: readWholeNumber(answer, LOWEST_PORT, HIGHEST_PORT, BAD_PORT) };
    case "healthPath":
      return { ...draft, healthPath: readHealthPath(answer) };
    case "cpu": {
      const { reserved, maximum } = readAmounts(answer, parseCpuToMillicores, BAD_CPU);
      if (parseCpuToMillicores(maximum) > MOST_CPU_MILLICORES) {
        throw new InvalidRequestError(tooMuchCpu(maximum));
      }
      return { ...draft, requests: { ...draft.requests, cpu: reserved }, limits: { ...draft.limits, cpu: maximum } };
    }
    case "memory": {
      const { reserved, maximum } = readAmounts(answer, parseMemoryToBytes, BAD_MEMORY);
      if (parseMemoryToBytes(reserved) < LEAST_MEMORY_BYTES) {
        throw new InvalidRequestError(tooLittleMemory(reserved));
      }
      return {
        ...draft,
        requests: { ...draft.requests, memory: reserved },
        limits: { ...draft.limits, memory: maximum },
      };
    }
    case "replicas":
      return { ...draft, replicas: readWholeNumber(answer, 1, MAX_COPIES, BAD_REPLICAS) };
    case "maxReplicas": {
      // A create has just asked for the number of copies. An edit has not, so there the lowest limit is 1.
      const lowest = draft.replicas ?? 1;
      return { ...draft, maxReplicas: readWholeNumber(answer, lowest, MAX_COPIES, badMaxReplicas(lowest)) };
    }
    case "variables":
      return { ...draft, env: readVariables(answer) };
  }
}

// ---- From the answers to the finished settings ----

/** The question after `field` in a create. Null after the last one. */
function nextField(field: WizardField, draft: ServiceDraft): WizardField | null {
  const remaining = CREATE_ORDER.slice(CREATE_ORDER.indexOf(field) + 1);
  for (const next of remaining) {
    // The environment is not asked for when it was named before the questions started.
    if (next === "environment" && draft.environment !== undefined) {
      continue;
    }
    return next;
  }
  return null;
}

/** The settings of a new service, once every question is answered. */
function createdSpec(draft: ServiceDraft): ServiceSpec {
  const name = stored(draft.name);
  return {
    name,
    environment: stored(draft.environment),
    // The image is named after the service.
    imageRepository: name,
    folder: stored(draft.folder),
    port: stored(draft.port),
    healthPath: stored(draft.healthPath),
    replicas: stored(draft.replicas),
    maxReplicas: stored(draft.maxReplicas),
    resources: {
      requests: { cpu: stored(draft.requests?.cpu), memory: stored(draft.requests?.memory) },
      limits: { cpu: stored(draft.limits?.cpu), memory: stored(draft.limits?.memory) },
    },
    env: stored(draft.env),
    // No image has been built yet.
    lastVersion: 0,
  };
}

/** The service as it was, with the one answer of an edit on top. Everything else stays untouched. */
function editedSpec(original: ServiceSpec, draft: ServiceDraft): ServiceSpec {
  return {
    ...original,
    port: draft.port ?? original.port,
    healthPath: draft.healthPath ?? original.healthPath,
    maxReplicas: draft.maxReplicas ?? original.maxReplicas,
    env: draft.env ?? original.env,
    resources: {
      requests: { ...original.resources.requests, ...draft.requests },
      limits: { ...original.resources.limits, ...draft.limits },
    },
  };
}

// ---- Handling one message ----

/** The answer to the first question of an edit: which setting to change. */
function pickSetting(wizard: Wizard, answer: string, context: WizardContext): WizardStep {
  // "Health  Path" and "health path" are the same answer.
  const words = answer.toLowerCase().replace(/\s+/g, " ");
  if (!Object.hasOwn(SETTING_WORDS, words)) {
    return askAgain(wizard, UNKNOWN_SETTING, context);
  }
  return ask({ ...wizard, field: SETTING_WORDS[words] }, context);
}

/** Checks an answer. Then asks the next question, or returns the finished settings. */
function takeAnswer(wizard: Wizard, answer: string, context: WizardContext): WizardStep {
  if (wizard.field === "change") {
    return pickSetting(wizard, answer, context);
  }

  let draft: ServiceDraft;
  try {
    draft = storeAnswer(wizard.draft, wizard.field, answer, context);
  } catch (error) {
    // A sentence meant for the user becomes the reply. Anything else is a real failure.
    if (error instanceof InvalidRequestError) {
      return askAgain(wizard, error.message, context);
    }
    throw error;
  }

  // An edit changes one setting, so one answer finishes it.
  if (wizard.kind === "edit") {
    return { kind: "done", spec: editedSpec(stored(wizard.original), draft) };
  }
  const next = nextField(wizard.field, draft);
  if (next === null) {
    return { kind: "done", spec: createdSpec(draft) };
  }
  return ask({ ...wizard, field: next, draft }, context);
}

/** The user typed "default". */
function takeDefault(wizard: Wizard, context: WizardContext): WizardStep {
  // In an edit the default is the value the service has now, so nothing changes.
  if (wizard.kind === "edit" && wizard.field !== "change") {
    return { kind: "done", spec: editedSpec(stored(wizard.original), wizard.draft) };
  }
  const suggested = defaultAnswer(wizard, context);
  if (suggested === null) {
    return askAgain(wizard, NO_DEFAULT, context);
  }
  // The suggested value goes through the same checks as a typed one.
  return takeAnswer(wizard, suggested, context);
}

// ---- Entry points, called by the chat agent ----

/**
 * Starts the questions that create a service. Always returns the first question.
 *
 * @param prefilled an environment the user already named; when it is a known one, its question is skipped
 */
export function startCreate(context: WizardContext, prefilled: { environment?: string } = {}): WizardStep {
  const draft: ServiceDraft = {};
  if (prefilled.environment !== undefined && context.environments.includes(prefilled.environment)) {
    draft.environment = prefilled.environment;
  }
  const wizard: Wizard = { kind: "create", field: "folder", draft };
  const question = questionFor(wizard, context);
  // Only this first reply explains how the questions work.
  return { kind: "ask", wizard, text: `${INTRO}\n${question}`, question };
}

/** Starts an edit of an existing service: shows its settings and asks which one to change. */
export function startEdit(spec: ServiceSpec, context: WizardContext): WizardStep {
  return ask({ kind: "edit", field: "change", draft: {}, original: spec }, context);
}

/**
 * Handles the answer to the question the wizard is waiting on. The wizard that is passed
 * in is never changed: the step that comes back carries a new one.
 */
export function answerWizard(wizard: Wizard, text: string, context: WizardContext): WizardStep {
  const answer = text.trim();
  const word = answer.toLowerCase();

  if (word === CANCEL_WORD) {
    return { kind: "cancelled", text: wizard.kind === "edit" ? EDIT_CANCELLED : CREATE_CANCELLED };
  }
  if (word === DEFAULT_WORD) {
    return takeDefault(wizard, context);
  }
  return takeAnswer(wizard, answer, context);
}
