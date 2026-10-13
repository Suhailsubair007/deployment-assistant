import assert from "node:assert/strict";
import { test } from "node:test";

import { createServiceFlow } from "@/agent/serviceFlow.ts";
import { startCreate, startEdit } from "@/agent/serviceWizard.ts";
import { InvalidRequestError } from "@/errors.ts";
import type { ServiceSpec } from "@/types/service.ts";
import type { WizardContext, WizardStep } from "@/types/wizard.ts";

/** Two environments, one project folder (~/code/orders-api) and no services yet. */
const context: WizardContext = {
  environments: ["staging", "prod"],
  defaults: {
    port: 8080,
    healthPath: "/health",
    replicas: 2,
    maxReplicas: 10,
    resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "256Mi" } },
  },
  exists: () => false,
  inspect: (path) => {
    if (path !== "~/code/orders-api") {
      throw new InvalidRequestError(`I can't find a folder at ${path}.`);
    }
    return { folder: "/Users/asha/code/orders-api", port: 3000, suggestedName: "orders-api" };
  },
};

function newFlow(maxOpen?: number) {
  return createServiceFlow({ context: () => context, maxOpen });
}

/** The step, checked to be a question that waits for an answer. */
function asked(step: WizardStep): Extract<WizardStep, { kind: "ask" }> {
  assert.equal(step.kind, "ask");
  return step as Extract<WizardStep, { kind: "ask" }>;
}

/** The answers that take a new service from the folder question to the finished settings. */
const ANSWERS = ["~/code/orders-api", "default", "staging", "default", "default", "default", "default", "default", "default", "none"];

test("starting the flow pauses at the first question and hands it back", async () => {
  const flow = newFlow();

  const step = asked(await flow.start("thread-1", startCreate(context)));

  assert.equal(step.wizard.field, "folder");
  assert.match(step.text, /Where is the project folder\?/);
});

test("an answer resumes the flow, which pauses again at the next question", async () => {
  const flow = newFlow();
  await flow.start("thread-1", startCreate(context));

  const step = asked(await flow.answer("thread-1", "~/code/orders-api"));

  assert.equal(step.wizard.field, "name");
  assert.equal(step.question, "What should the service be called?\nDefault: orders-api");
  assert.equal(step.rejected, undefined);
});

test("a bad answer pauses at the same question again, with the reason", async () => {
  const flow = newFlow();
  await flow.start("thread-1", startCreate(context));

  const step = asked(await flow.answer("thread-1", "/nowhere"));
  const next = asked(await flow.answer("thread-1", "~/code/orders-api"));

  assert.equal(step.wizard.field, "folder");
  assert.equal(step.rejected, true);
  assert.match(step.text, /^I can't find a folder at \/nowhere\.\n/);
  // The flow is still open at that question: a good answer moves on.
  assert.equal(next.wizard.field, "name");
});

test("the last answer ends the flow with the finished settings", async () => {
  const flow = newFlow();
  let step = await flow.start("thread-1", startCreate(context));
  for (const answer of ANSWERS) {
    step = await flow.answer("thread-1", answer);
  }

  assert.equal(step.kind, "done");
  const spec = (step as Extract<WizardStep, { kind: "done" }>).spec;
  assert.equal(spec.name, "orders-api");
  assert.equal(spec.environment, "staging");
  assert.equal(spec.port, 3000);
  assert.equal(spec.folder, "/Users/asha/code/orders-api");
});

test("cancel ends the flow", async () => {
  const flow = newFlow();
  await flow.start("thread-1", startCreate(context));

  const step = await flow.answer("thread-1", "cancel");

  assert.deepEqual(step, { kind: "cancelled", text: "Cancelled. Nothing was created." });
});

test("two conversations are kept apart", async () => {
  const flow = newFlow();
  await flow.start("tab-a", startCreate(context));
  await flow.start("tab-b", startCreate(context));

  await flow.answer("tab-a", "~/code/orders-api");
  const b = asked(await flow.answer("tab-b", "/nowhere"));
  const a = asked(await flow.answer("tab-a", "billing"));

  assert.equal(b.wizard.field, "folder");
  assert.equal(a.wizard.field, "environment");
  assert.equal(a.wizard.draft.name, "billing");
});

test("an edit runs through the same flow: pick the setting, give the value, done", async () => {
  const spec: ServiceSpec = {
    name: "orders-api",
    environment: "staging",
    imageRepository: "orders-api",
    folder: "/Users/asha/code/orders-api",
    port: 3000,
    healthPath: "/health",
    replicas: 2,
    maxReplicas: 10,
    resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "256Mi" } },
    env: [],
    lastVersion: 1,
  };
  const flow = newFlow();
  await flow.start("thread-1", startEdit(spec, context));

  const question = asked(await flow.answer("thread-1", "port"));
  const done = await flow.answer("thread-1", "4000");

  assert.equal(question.wizard.field, "port");
  assert.equal(done.kind, "done");
  assert.equal((done as Extract<WizardStep, { kind: "done" }>).spec.port, 4000);
});

test("an answer for a conversation that is not open says the questions are gone", async () => {
  const flow = newFlow();

  const never = await flow.answer("unknown", "staging");
  await flow.start("thread-1", startCreate(context));
  await flow.answer("thread-1", "cancel");
  const ended = await flow.answer("thread-1", "staging");

  const gone = { kind: "cancelled", text: 'I lost track of these questions. Type "create a service" to start again.' };
  assert.deepEqual(never, gone);
  assert.deepEqual(ended, gone);
});

test("only so many conversations are kept open: the oldest is forgotten first", async () => {
  const flow = newFlow(2);
  await flow.start("first", startCreate(context));
  await flow.start("second", startCreate(context));
  await flow.start("third", startCreate(context));

  assert.equal((await flow.answer("first", "~/code/orders-api")).kind, "cancelled");
  assert.equal((await flow.answer("third", "~/code/orders-api")).kind, "ask");
});
