import assert from "node:assert/strict";
import { test } from "node:test";

import { answerWizard, startCreate, startEdit } from "@/agent/serviceWizard.ts";
import { InvalidRequestError } from "@/errors.ts";
import type { ProjectInfo } from "@/types/build.ts";
import type { ServiceDefaults } from "@/types/config.ts";
import type { ServiceSpec } from "@/types/service.ts";
import type { Wizard, WizardContext, WizardField, WizardStep } from "@/types/wizard.ts";

// ---- A small world made by hand: no files are read ----

const PROJECT: ProjectInfo = { folder: "/Users/asha/code/orders-api", port: 3000, suggestedName: "orders-api" };

const DEFAULTS: ServiceDefaults = {
  port: 8080,
  healthPath: "/health",
  replicas: 2,
  maxReplicas: 10,
  resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "256Mi" } },
};

/**
 * Two environments, one project folder (~/code/orders-api), and one service that
 * already exists: "billing" in staging.
 */
function makeContext(project: ProjectInfo = PROJECT): WizardContext {
  return {
    environments: ["staging", "prod"],
    defaults: DEFAULTS,
    exists: (environment, name) => environment === "staging" && name === "billing",
    inspect: (path) => {
      if (path !== "~/code/orders-api") {
        throw new InvalidRequestError(`I can't find a folder at ${path}.`);
      }
      return project;
    },
  };
}

// The questions as the user sees them when every suggested value comes from PROJECT and DEFAULTS.
const INTRO = "I'll ask one thing at a time. Type cancel to stop, or default to take the suggested value.";
const QUESTIONS: Record<string, string> = {
  folder:
    "Where is the project folder? Give the full path, for example ~/code/orders-api. It must contain a Dockerfile.",
  name: "What should the service be called?\nDefault: orders-api",
  environment: "Which environment: staging or prod?",
  port: "Which port does the app listen on?\nDefault: 3000 (from the Dockerfile)",
  healthPath: "Which path answers the health check? It must return 200 when the app is ready.\nDefault: /health",
  cpu: "How much CPU for each copy? Give the reserved amount and the maximum, for example 100m to 500m (1000m is one core). One amount sets both.\nDefault: 100m to 500m",
  memory:
    "How much memory for each copy? Give the reserved amount and the maximum, for example 128Mi to 256Mi. One amount sets both. A copy that goes over the maximum is restarted.\nDefault: 128Mi to 256Mi",
  replicas: "How many copies should run?\nDefault: 2",
  maxReplicas: "What is the most it may be scaled to? This is only a limit for the scale command.\nDefault: 10",
  variables:
    "Any environment variables? Type them as NAME=value, separated by spaces, for example NODE_ENV=production LOG_LEVEL=info. Type none to skip. They are stored and shown as plain text, so do not put passwords or keys here.\nDefault: none",
};

// One answer that is accepted at each question.
const GOOD_ANSWERS: Record<string, string> = {
  folder: "~/code/orders-api",
  name: "orders-api",
  environment: "staging",
  port: "3000",
  healthPath: "/healthz",
  cpu: "100m to 500m",
  memory: "128Mi to 256Mi",
  replicas: "2",
  maxReplicas: "5",
  variables: "NODE_ENV=production LOG_LEVEL=info",
};

/** The step as a question. Fails the test when the step is something else. */
function asked(step: WizardStep): Extract<WizardStep, { kind: "ask" }> {
  if (step.kind !== "ask") {
    assert.fail(`expected a question, but the step is "${step.kind}"`);
  }
  return step;
}

/** The finished settings. Fails the test when the questions are not over. */
function finished(step: WizardStep): ServiceSpec {
  if (step.kind !== "done") {
    assert.fail(`expected the finished settings, but the step is "${step.kind}"`);
  }
  return step.spec;
}

/** A create that was answered with GOOD_ANSWERS until it reached the given question. */
function createAt(
  field: WizardField,
  context: WizardContext = makeContext(),
  prefilled?: { environment?: string },
): Wizard {
  let step = asked(startCreate(context, prefilled));
  while (step.wizard.field !== field) {
    step = asked(answerWizard(step.wizard, GOOD_ANSWERS[step.wizard.field], context));
  }
  return step.wizard;
}

/** Answers the given question of a create, after good answers to the ones before it. */
function answerAt(field: WizardField, text: string, context: WizardContext = makeContext()): WizardStep {
  return answerWizard(createAt(field, context), text, context);
}

/** Checks that an answer was refused with this sentence and that the same question is asked again. */
function assertRefused(step: WizardStep, field: WizardField, sentence: string, question: string): void {
  const again = asked(step);
  assert.equal(again.wizard.field, field);
  assert.equal(again.rejected, true);
  assert.equal(again.question, question);
  assert.equal(again.text, `${sentence}\n${question}`);
}

// ---- Creating a service: from the first question to the finished settings ----

test("the first reply explains cancel and default, and asks for the project folder", () => {
  const step = asked(startCreate(makeContext()));

  assert.equal(step.text, `${INTRO}\n${QUESTIONS.folder}`);
  assert.equal(step.question, QUESTIONS.folder);
  assert.equal(step.rejected, undefined);
  assert.deepEqual(step.wizard, { kind: "create", field: "folder", draft: {} });
});

test("the questions come one at a time in a fixed order and end with the finished settings", () => {
  const context = makeContext();
  const order: WizardField[] = [
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

  let step = startCreate(context);
  for (const field of order) {
    const question = asked(step);
    assert.equal(question.wizard.field, field);
    assert.equal(question.question, QUESTIONS[field]);
    step = answerWizard(question.wizard, GOOD_ANSWERS[field], context);
  }

  assert.deepEqual(step, {
    kind: "done",
    spec: {
      name: "orders-api",
      environment: "staging",
      imageRepository: "orders-api",
      folder: "/Users/asha/code/orders-api",
      port: 3000,
      healthPath: "/healthz",
      replicas: 2,
      maxReplicas: 5,
      resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "256Mi" } },
      env: [
        { name: "NODE_ENV", value: "production" },
        { name: "LOG_LEVEL", value: "info" },
      ],
      lastVersion: 0,
    },
  });
});

test("typing default at every question that has one gives the suggested values", () => {
  const context = makeContext();
  const answers = ["~/code/orders-api", "default", "prod", "default", "default", "default", "default", "default", "default", "default"];

  let step = startCreate(context);
  for (const answer of answers) {
    step = answerWizard(asked(step).wizard, answer, context);
  }

  assert.deepEqual(finished(step), {
    name: "orders-api",
    environment: "prod",
    imageRepository: "orders-api",
    folder: "/Users/asha/code/orders-api",
    port: 3000,
    healthPath: "/health",
    replicas: 2,
    maxReplicas: 10,
    resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "256Mi" } },
    env: [],
    lastVersion: 0,
  });
});

test("an accepted answer is followed by the next question alone, and is not marked as rejected", () => {
  const step = asked(answerAt("port", "3000"));

  assert.equal(step.wizard.field, "healthPath");
  assert.equal(step.question, QUESTIONS.healthPath);
  assert.equal(step.text, QUESTIONS.healthPath);
  assert.equal(step.rejected, undefined);
});

test("a refused answer is marked as rejected and carries the question that was asked", () => {
  const step = asked(answerAt("port", "eighty"));

  assert.equal(step.wizard.field, "port");
  assert.equal(step.rejected, true);
  assert.equal(step.question, QUESTIONS.port);
  assert.equal(step.text, `The port must be a whole number from 1024 to 65535.\n${QUESTIONS.port}`);
});

test("the wizard that is passed in is not changed, whether the answer is good or bad", () => {
  const context = makeContext();
  const wizard = createAt("cpu", context);
  const before = structuredClone(wizard);

  const accepted = asked(answerWizard(wizard, "250m", context));
  answerWizard(wizard, "abc", context);

  assert.deepEqual(wizard, before);
  assert.notEqual(accepted.wizard, wizard);
  assert.notEqual(accepted.wizard.draft, wizard.draft);
});

// ---- cancel and default ----

test("cancel at the first question stops without creating anything", () => {
  const context = makeContext();

  const step = answerWizard(asked(startCreate(context)).wizard, "cancel", context);

  assert.deepEqual(step, { kind: "cancelled", text: "Cancelled. Nothing was created." });
});

test("cancel at a later question stops too, in any case and with spaces around it", () => {
  assert.deepEqual(answerAt("memory", "  Cancel "), { kind: "cancelled", text: "Cancelled. Nothing was created." });
});

test("default at the folder question says there is none and asks again", () => {
  assertRefused(answerAt("folder", "default"), "folder", "There is no default for this one.", QUESTIONS.folder);
});

test("default at the environment question says there is none and asks again", () => {
  assertRefused(
    answerAt("environment", "Default"),
    "environment",
    "There is no default for this one.",
    QUESTIONS.environment,
  );
});

// ---- The folder ----

test("a good folder is stored with what was found in it", () => {
  const step = asked(answerAt("folder", "  ~/code/orders-api "));

  assert.equal(step.wizard.field, "name");
  assert.equal(step.wizard.draft.folder, "/Users/asha/code/orders-api");
  assert.deepEqual(step.wizard.draft.project, PROJECT);
});

test("a folder that the check refuses is answered with the check's own sentence", () => {
  assertRefused(answerAt("folder", "~/code/nope"), "folder", "I can't find a folder at ~/code/nope.", QUESTIONS.folder);
});

test("an unexpected problem while checking the folder is not turned into a reply", () => {
  const context: WizardContext = {
    ...makeContext(),
    inspect: () => {
      throw new Error("disk on fire");
    },
  };

  assert.throws(() => answerWizard(createAt("folder", context), "~/code/orders-api", context), new Error("disk on fire"));
});

// ---- The name ----

test("a good name is stored", () => {
  const step = asked(answerAt("name", "orders-api-2"));

  assert.equal(step.wizard.field, "environment");
  assert.equal(step.wizard.draft.name, "orders-api-2");
});

test("default at the name question takes the name made from the folder", () => {
  assert.equal(asked(answerAt("name", "default")).wizard.draft.name, "orders-api");
});

test("the name question has no default when the folder's name cannot be used", () => {
  const context = makeContext({ ...PROJECT, suggestedName: null });

  const question = asked(answerAt("folder", "~/code/orders-api", context));
  assert.equal(question.question, "What should the service be called?");

  assertRefused(
    answerWizard(question.wizard, "default", context),
    "name",
    "There is no default for this one.",
    "What should the service be called?",
  );
});

const badNames: [what: string, name: string][] = [
  ["capital letters", "Orders-API"],
  ["a digit at the start", "9lives"],
  ["a dash at the end", "orders-"],
  ["an underscore", "orders_api"],
  ["a space", "orders api"],
  ["41 characters", "a".repeat(41)],
];
for (const [what, name] of badNames) {
  test(`a name with ${what} is refused`, () => {
    assertRefused(
      answerAt("name", name),
      "name",
      "A name uses lowercase letters, digits and single dashes. It starts with a letter, ends with a letter or a digit, and is at most 40 characters long.",
      QUESTIONS.name,
    );
  });
}

test("a name of exactly 40 characters is accepted", () => {
  assert.equal(asked(answerAt("name", "a".repeat(40))).wizard.field, "environment");
});

// ---- The environment ----

const environmentAnswers: [answer: string, environment: string][] = [
  ["staging", "staging"],
  ["PROD", "prod"],
  ["Production", "prod"], // another word for prod
  ["prod.", "prod"],
  ["staging?", "staging"],
  ["stagin", "staging"], // one typing mistake is forgiven
];
for (const [answer, environment] of environmentAnswers) {
  test(`the environment answer "${answer}" means ${environment}`, () => {
    const step = asked(answerAt("environment", answer));

    assert.equal(step.wizard.field, "port");
    assert.equal(step.wizard.draft.environment, environment);
    assert.equal(step.rejected, undefined);
  });
}

test("an environment that does not exist is refused, and the question names the ones that do", () => {
  assertRefused(answerAt("environment", "qa"), "environment", "I don't know that environment.", QUESTIONS.environment);
});

// The answer must be the environment alone. A sentence that only mentions one is most
// likely another request, typed in the middle of the questions.
for (const answer of ["deploy sample-app version v2 to staging", "the staging one please", "staging prod"]) {
  test(`"${answer}" is more than one word, so it is refused as an environment`, () => {
    assertRefused(
      answerAt("environment", answer),
      "environment",
      "I don't know that environment.",
      QUESTIONS.environment,
    );
  });
}

test("a name that is already used in the environment is refused, and another environment can be given", () => {
  const context = makeContext();
  const wizard = asked(answerWizard(createAt("name", context), "billing", context)).wizard;

  const refused = answerWizard(wizard, "staging", context);

  assertRefused(
    refused,
    "environment",
    "There is already a service called billing in staging. Name another environment, or type cancel and start again with another name.",
    QUESTIONS.environment,
  );
  const next = asked(answerWizard(asked(refused).wizard, "prod", context));
  assert.equal(next.wizard.field, "port");
  assert.equal(next.wizard.draft.environment, "prod");
});

test("an environment named before the questions start is not asked for", () => {
  const context = makeContext();

  let step = startCreate(context, { environment: "prod" });
  const fields: WizardField[] = [];
  while (step.kind === "ask") {
    fields.push(step.wizard.field);
    step = answerWizard(step.wizard, GOOD_ANSWERS[step.wizard.field], context);
  }

  assert.deepEqual(fields, ["folder", "name", "port", "healthPath", "cpu", "memory", "replicas", "maxReplicas", "variables"]);
  assert.equal(finished(step).environment, "prod");
});

test("an unknown environment named before the questions start is ignored, so the question is asked", () => {
  const context = makeContext();

  const step = asked(answerWizard(createAt("name", context, { environment: "qa" }), "orders-api", context));

  assert.equal(step.wizard.field, "environment");
});

test("with the environment already named, a name that is used there is refused and the name is asked again", () => {
  const context = makeContext();
  const wizard = createAt("name", context, { environment: "staging" });

  const refused = answerWizard(wizard, "billing", context);

  assertRefused(refused, "name", "There is already a service called billing in staging. Give another name.", QUESTIONS.name);
  const next = asked(answerWizard(asked(refused).wizard, "billing-2", context));
  assert.equal(next.wizard.field, "port");
});

// ---- The port ----

test("a good port is stored as a number", () => {
  const step = asked(answerAt("port", "4000"));

  assert.equal(step.wizard.field, "healthPath");
  assert.equal(step.wizard.draft.port, 4000);
});

test("default at the port question takes the port from the Dockerfile", () => {
  assert.equal(asked(answerAt("port", "default")).wizard.draft.port, 3000);
});

const dockerfilePortsNotUsed: [what: string, port: number | null][] = [
  ["names no port", null],
  ["names a port below 1024", 80],
  ["names a port above 65535", 70000],
];
for (const [what, port] of dockerfilePortsNotUsed) {
  test(`when the Dockerfile ${what}, the default port comes from the config`, () => {
    const context = makeContext({ ...PROJECT, port });
    const wizard = createAt("port", context);

    const question = asked(answerWizard(createAt("environment", context), "staging", context));
    assert.equal(question.question, "Which port does the app listen on?\nDefault: 8080");

    assert.equal(asked(answerWizard(wizard, "default", context)).wizard.draft.port, 8080);
  });
}

for (const port of ["80", "1023", "65536", "eighty", "30.5", "3e3", "-3000"]) {
  test(`the port "${port}" is refused`, () => {
    assertRefused(answerAt("port", port), "port", "The port must be a whole number from 1024 to 65535.", QUESTIONS.port);
  });
}

test("the lowest and the highest port are accepted", () => {
  assert.equal(asked(answerAt("port", "1024")).wizard.draft.port, 1024);
  assert.equal(asked(answerAt("port", "65535")).wizard.draft.port, 65535);
});

// ---- The health check path ----

test("a good health check path is stored", () => {
  const step = asked(answerAt("healthPath", "/api/v1/health-check"));

  assert.equal(step.wizard.field, "cpu");
  assert.equal(step.wizard.draft.healthPath, "/api/v1/health-check");
});

test("default at the health check question takes the path from the config", () => {
  assert.equal(asked(answerAt("healthPath", "default")).wizard.draft.healthPath, "/health");
});

const badPaths: [what: string, path: string][] = [
  ["no / at the start", "health"],
  ["a space", "/health check"],
  ["a question mark", "/health?full=1"],
  ["101 characters", `/${"a".repeat(100)}`],
];
for (const [what, path] of badPaths) {
  test(`a health check path with ${what} is refused`, () => {
    assertRefused(
      answerAt("healthPath", path),
      "healthPath",
      "The path must start with / and use only letters, digits and the characters / . _ ~ and -. It can be at most 100 characters long.",
      QUESTIONS.healthPath,
    );
  });
}

// ---- CPU ----

const cpuAnswers: [answer: string, reserved: string, maximum: string][] = [
  ["250m", "250m", "250m"], // one amount sets both
  ["100m to 500m", "100m", "500m"],
  ["100m TO 500m", "100m", "500m"],
  ["100m-500m", "100m", "500m"],
  ["100m - 500m", "100m", "500m"],
  ["100m, 500m", "100m", "500m"],
  ["100m 500m", "100m", "500m"],
  ["0.5 to 1", "0.5", "1"], // kept as typed: half a core to one core
  ["default", "100m", "500m"],
];
for (const [answer, reserved, maximum] of cpuAnswers) {
  test(`the CPU answer "${answer}" reserves ${reserved} and allows ${maximum}`, () => {
    const step = asked(answerAt("cpu", answer));

    assert.equal(step.wizard.field, "memory");
    assert.deepEqual(step.wizard.draft.requests, { cpu: reserved });
    assert.deepEqual(step.wizard.draft.limits, { cpu: maximum });
  });
}

for (const answer of ["abc", "0", "100m to abc", "100m to 200m to 300m", "100Mi", "to"]) {
  test(`the CPU answer "${answer}" is refused`, () => {
    assertRefused(
      answerAt("cpu", answer),
      "cpu",
      "I need one CPU amount or two, for example 250m or 100m to 500m.",
      QUESTIONS.cpu,
    );
  });
}

test("a reserved amount of CPU above the maximum is refused", () => {
  assertRefused(
    answerAt("cpu", "500m to 100m"),
    "cpu",
    "The reserved amount cannot be larger than the maximum. Give the smaller amount first.",
    QUESTIONS.cpu,
  );
});

// ---- Memory ----

const memoryAnswers: [answer: string, reserved: string, maximum: string][] = [
  ["256Mi", "256Mi", "256Mi"],
  ["128Mi to 1Gi", "128Mi", "1Gi"],
  ["128Mi-256Mi", "128Mi", "256Mi"],
  ["default", "128Mi", "256Mi"],
];
for (const [answer, reserved, maximum] of memoryAnswers) {
  test(`the memory answer "${answer}" reserves ${reserved} and allows ${maximum}`, () => {
    const step = asked(answerAt("memory", answer));

    assert.equal(step.wizard.field, "replicas");
    // The CPU answer given before it stays.
    assert.deepEqual(step.wizard.draft.requests, { cpu: "100m", memory: reserved });
    assert.deepEqual(step.wizard.draft.limits, { cpu: "500m", memory: maximum });
  });
}

for (const answer of ["abc", "0Mi", "128mi", "128Mi to lots", "1 2 3"]) {
  test(`the memory answer "${answer}" is refused`, () => {
    assertRefused(
      answerAt("memory", answer),
      "memory",
      "I need one memory amount or two, for example 256Mi or 128Mi to 256Mi.",
      QUESTIONS.memory,
    );
  });
}

test("a reserved amount of memory above the maximum is refused", () => {
  assertRefused(
    answerAt("memory", "1Gi to 512Mi"),
    "memory",
    "The reserved amount cannot be larger than the maximum. Give the smaller amount first.",
    QUESTIONS.memory,
  );
});

// ---- The number of copies ----

test("a good number of copies is stored", () => {
  const step = asked(answerAt("replicas", "3"));

  assert.equal(step.wizard.field, "maxReplicas");
  assert.equal(step.wizard.draft.replicas, 3);
});

test("default at the copies question takes the number from the config", () => {
  assert.equal(asked(answerAt("replicas", "default")).wizard.draft.replicas, 2);
});

for (const answer of ["0", "51", "two", "2.5"]) {
  test(`"${answer}" copies is refused`, () => {
    assertRefused(
      answerAt("replicas", answer),
      "replicas",
      "The number of copies must be a whole number from 1 to 50.",
      QUESTIONS.replicas,
    );
  });
}

// ---- The scaling limit ----

test("a good scaling limit is stored", () => {
  const step = asked(answerAt("maxReplicas", "8"));

  assert.equal(step.wizard.field, "variables");
  assert.equal(step.wizard.draft.maxReplicas, 8);
});

test("the scaling limit may equal the number of copies", () => {
  assert.equal(asked(answerAt("maxReplicas", "2")).wizard.draft.maxReplicas, 2);
});

test("default at the scaling limit question takes the limit from the config", () => {
  assert.equal(asked(answerAt("maxReplicas", "default")).wizard.draft.maxReplicas, 10);
});

test("the default scaling limit is the number of copies when that is above the limit from the config", () => {
  const context = makeContext();

  const question = asked(answerWizard(createAt("replicas", context), "20", context));
  assert.equal(
    question.question,
    "What is the most it may be scaled to? This is only a limit for the scale command.\nDefault: 20",
  );

  assert.equal(asked(answerWizard(question.wizard, "default", context)).wizard.draft.maxReplicas, 20);
});

for (const answer of ["1", "51", "many"]) {
  test(`a scaling limit of "${answer}" for 2 copies is refused`, () => {
    assertRefused(
      answerAt("maxReplicas", answer),
      "maxReplicas",
      "The limit must be a whole number from 2 to 50.",
      QUESTIONS.maxReplicas,
    );
  });
}

// ---- The variables ----

test("variables are stored in the order they were typed", () => {
  const spec = finished(answerAt("variables", "NODE_ENV=production  LOG_LEVEL=info"));

  assert.deepEqual(spec.env, [
    { name: "NODE_ENV", value: "production" },
    { name: "LOG_LEVEL", value: "info" },
  ]);
});

test('a value may contain "=" and may be empty', () => {
  const spec = finished(answerAt("variables", "DATABASE_URL=postgres://db/orders?sslmode=require EMPTY="));

  assert.deepEqual(spec.env, [
    { name: "DATABASE_URL", value: "postgres://db/orders?sslmode=require" },
    { name: "EMPTY", value: "" },
  ]);
});

for (const answer of ["none", "None", "default"]) {
  test(`"${answer}" at the variables question means no variables`, () => {
    assert.deepEqual(finished(answerAt("variables", answer)).env, []);
  });
}

for (const answer of ["LOG_LEVEL", "=info", "LOG_LEVEL = info", 'GREETING="hello world"']) {
  test(`the variables answer '${answer}' is refused`, () => {
    assertRefused(
      answerAt("variables", answer),
      "variables",
      "I need NAME=value pieces separated by spaces, for example LOG_LEVEL=info. A value cannot contain spaces.",
      QUESTIONS.variables,
    );
  });
}

test("a variable name that starts with a digit is refused", () => {
  assertRefused(
    answerAt("variables", "NODE_ENV=production 2FAST=yes"),
    "variables",
    "2FAST cannot be used as a name. A name uses letters, digits and underscores, and does not start with a digit.",
    QUESTIONS.variables,
  );
});

test("the same variable name twice is refused", () => {
  assertRefused(
    answerAt("variables", "LOG_LEVEL=info LOG_LEVEL=debug"),
    "variables",
    "LOG_LEVEL is in the list twice. Give each name once.",
    QUESTIONS.variables,
  );
});

/** "V1=x V2=x ... V<count>=x" */
function manyVariables(count: number): string {
  return Array.from({ length: count }, (_, index) => `V${index + 1}=x`).join(" ");
}

test("20 variables are accepted and 21 are refused", () => {
  assert.equal(finished(answerAt("variables", manyVariables(20))).env.length, 20);

  assertRefused(
    answerAt("variables", manyVariables(21)),
    "variables",
    "That is more than 20 variables. Give 20 at most.",
    QUESTIONS.variables,
  );
});

// ---- Changing one setting of a service that exists ----

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
    env: [
      { name: "NODE_ENV", value: "production" },
      { name: "LOG_LEVEL", value: "info" },
    ],
    lastVersion: 3,
    ...overrides,
  };
}

const SETTINGS_LIST = [
  "What do you want to change in orders-api (staging)?",
  "cpu | 100m to 500m",
  "memory | 128Mi to 256Mi",
  "port | 3000",
  "health path | /healthz",
  "variables | NODE_ENV, LOG_LEVEL",
  "max replicas | 5",
  "Type one of: cpu, memory, port, health path, variables, max replicas. To change the number of copies, type: scale orders-api in staging to 3.",
].join("\n");

/** An edit of orders-api that has picked a setting and waits for its new value. */
function editAt(setting: string, spec: ServiceSpec = ordersApi()): Extract<WizardStep, { kind: "ask" }> {
  const context = makeContext();
  return asked(answerWizard(asked(startEdit(spec, context)).wizard, setting, context));
}

test("an edit starts with the current settings as a table and the words that can be typed", () => {
  const spec = ordersApi();

  const step = asked(startEdit(spec, makeContext()));

  assert.equal(step.text, SETTINGS_LIST);
  assert.equal(step.question, SETTINGS_LIST);
  assert.equal(step.rejected, undefined);
  assert.deepEqual(step.wizard, { kind: "edit", field: "change", draft: {}, original: spec });
});

test("a service without variables shows none in the table", () => {
  const step = asked(startEdit(ordersApi({ env: [] }), makeContext()));

  assert.ok(step.text.includes("\nvariables | none\n"));
});

const settingWords: [word: string, field: WizardField][] = [
  ["cpu", "cpu"],
  ["CPU", "cpu"],
  ["memory", "memory"],
  ["ram", "memory"],
  ["port", "port"],
  ["health path", "healthPath"],
  ["Health  Path", "healthPath"],
  ["health", "healthPath"],
  ["healthpath", "healthPath"],
  ["variables", "variables"],
  ["env", "variables"],
  ["max replicas", "maxReplicas"],
  ["max", "maxReplicas"],
  ["maxreplicas", "maxReplicas"],
];
for (const [word, field] of settingWords) {
  test(`"${word}" picks the ${field} setting`, () => {
    const step = editAt(word);

    assert.equal(step.wizard.field, field);
    assert.equal(step.rejected, undefined);
  });
}

for (const word of ["colour", "replicas", "constructor", ""]) {
  test(`"${word}" is not a setting, so the list is shown again`, () => {
    const context = makeContext();

    const step = answerWizard(asked(startEdit(ordersApi(), context)).wizard, word, context);

    assertRefused(step, "change", "I don't know that setting.", SETTINGS_LIST);
  });
}

test("default at the list of settings says there is none", () => {
  const context = makeContext();

  const step = answerWizard(asked(startEdit(ordersApi(), context)).wizard, "default", context);

  assertRefused(step, "change", "There is no default for this one.", SETTINGS_LIST);
});

test("the question for the picked setting shows its value now instead of a default", () => {
  const step = editAt("memory");

  assert.equal(
    step.text,
    "How much memory for each copy? Give the reserved amount and the maximum, for example 128Mi to 256Mi. One amount sets both. A copy that goes over the maximum is restarted.\nNow: 128Mi to 256Mi",
  );
  assert.equal(step.question, step.text);
});

test("changing the memory gives the service back with only the memory changed", () => {
  const context = makeContext();
  const original = ordersApi();

  const step = answerWizard(editAt("memory", original).wizard, "256Mi to 512Mi", context);

  assert.deepEqual(step, {
    kind: "done",
    spec: ordersApi({
      resources: { requests: { cpu: "100m", memory: "256Mi" }, limits: { cpu: "500m", memory: "512Mi" } },
    }),
  });
  // The service that was handed in is left as it was.
  assert.deepEqual(original, ordersApi());
});

test("changing the CPU with one amount sets the reserved amount and the maximum", () => {
  const spec = finished(answerWizard(editAt("cpu").wizard, "250m", makeContext()));

  assert.deepEqual(spec.resources, {
    requests: { cpu: "250m", memory: "128Mi" },
    limits: { cpu: "250m", memory: "256Mi" },
  });
});

test("changing the port and the health check path", () => {
  const context = makeContext();

  assert.deepEqual(finished(answerWizard(editAt("port").wizard, "4000", context)), ordersApi({ port: 4000 }));
  assert.deepEqual(
    finished(answerWizard(editAt("health path").wizard, "/ready", context)),
    ordersApi({ healthPath: "/ready" }),
  );
});

test("the variables question of an edit shows the list now and says the answer replaces it", () => {
  assert.equal(
    editAt("variables").text,
    [
      "Any environment variables? Type them as NAME=value, separated by spaces, for example NODE_ENV=production LOG_LEVEL=info. Type none to skip. They are stored and shown as plain text, so do not put passwords or keys here.",
      "Your answer replaces the whole list, and none removes them all.",
      "Now: NODE_ENV=production LOG_LEVEL=info",
    ].join("\n"),
  );
});

test("new variables replace the whole list", () => {
  const spec = finished(answerWizard(editAt("variables").wizard, "LOG_LEVEL=debug", makeContext()));

  assert.deepEqual(spec, ordersApi({ env: [{ name: "LOG_LEVEL", value: "debug" }] }));
});

test("none removes every variable", () => {
  const spec = finished(answerWizard(editAt("variables").wizard, "none", makeContext()));

  assert.deepEqual(spec, ordersApi({ env: [] }));
});

test("in an edit the scaling limit may go down to 1, whatever the number of copies", () => {
  const context = makeContext();

  assert.deepEqual(finished(answerWizard(editAt("max replicas").wizard, "1", context)), ordersApi({ maxReplicas: 1 }));
  assertRefused(
    answerWizard(editAt("max replicas").wizard, "0", context),
    "maxReplicas",
    "The limit must be a whole number from 1 to 50.",
    "What is the most it may be scaled to? This is only a limit for the scale command.\nNow: 5",
  );
});

test("a bad answer in an edit is refused with the same sentence as in a create", () => {
  assertRefused(
    answerWizard(editAt("port").wizard, "80", makeContext()),
    "port",
    "The port must be a whole number from 1024 to 65535.",
    "Which port does the app listen on?\nNow: 3000",
  );
});

for (const setting of ["cpu", "memory", "port", "health path", "variables", "max replicas"]) {
  test(`default at the ${setting} question of an edit keeps the value the service has now`, () => {
    const step = answerWizard(editAt(setting).wizard, "default", makeContext());

    assert.deepEqual(step, { kind: "done", spec: ordersApi() });
  });
}

test("default keeps a value that a new answer would not be allowed to have", () => {
  // An app from the config file may listen on a port that the questions would refuse.
  const original = ordersApi({ port: 80 });

  const step = answerWizard(editAt("port", original).wizard, "default", makeContext());

  assert.deepEqual(step, { kind: "done", spec: original });
});

test("cancel in an edit stops without changing anything, at the list and at a setting", () => {
  const context = makeContext();
  const cancelled = { kind: "cancelled", text: "Cancelled. Nothing was changed." };

  assert.deepEqual(answerWizard(asked(startEdit(ordersApi(), context)).wizard, "cancel", context), cancelled);
  assert.deepEqual(answerWizard(editAt("cpu").wizard, "CANCEL", context), cancelled);
});

test("picking a setting does not change the wizard that was passed in", () => {
  const context = makeContext();
  const wizard = asked(startEdit(ordersApi(), context)).wizard;
  const before = structuredClone(wizard);

  answerWizard(wizard, "memory", context);

  assert.deepEqual(wizard, before);
});

// ---- Amounts typed without a unit ----

test("memory without a unit is refused, because a bare number means bytes", () => {
  const step = asked(answerAt("memory", "128 to 256"));

  assert.equal(step.rejected, true);
  assert.equal(step.wizard.field, "memory");
  assert.match(step.text, /^128 is far too little memory for an app to start\. A number without a unit means bytes: add a unit, for example 128Mi\.\n/);
});

test("the smallest memory that is accepted is 8Mi", () => {
  assert.equal(asked(answerAt("memory", "4Mi")).rejected, true);
  assert.equal(asked(answerAt("memory", "8Mi to 16Mi")).wizard.field, "replicas");
});

test("CPU without a unit is refused when it is more whole cores than a machine has", () => {
  const step = asked(answerAt("cpu", "100 to 500"));

  assert.equal(step.rejected, true);
  assert.equal(step.wizard.field, "cpu");
  assert.match(
    step.text,
    /^500 means 500 whole cores, which is more than I allow \(16\)\. For a part of a core add m, for example 500m \(1000m is one core\)\.\n/,
  );
});

test("a few whole cores are still accepted", () => {
  assert.equal(asked(answerAt("cpu", "1 to 2")).wizard.field, "memory");
  assert.equal(asked(answerAt("cpu", "0.5")).wizard.field, "memory");
});

test("a name with two dashes in a row is refused: the image repository would not accept it", () => {
  const step = asked(answerAt("name", "orders--api"));

  assert.equal(step.rejected, true);
  assert.equal(step.wizard.field, "name");
  assert.equal(asked(answerAt("name", "orders-api-2")).rejected, undefined);
});
