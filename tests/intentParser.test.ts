import assert from "node:assert/strict";
import { test } from "node:test";

import { parseMessage } from "@/agent/intentParser.ts";
import type { ParsedMessage } from "@/types/agent.ts";
import { buildCapabilities } from "../frontend/lib/capabilities.ts";

const known = { environments: ["staging", "prod"], apps: ["sample-app"] };

const cases: [message: string, expected: ParsedMessage][] = [
  // The sentences from the test description
  ["deploy sample-app version v2 to staging", { intent: "deploy", app: "sample-app", version: "v2", environment: "staging" }],
  ["is it healthy?", { intent: "health" }],
  ["how much cpu and ram is it using?", { intent: "usage" }],
  ["which pod is using the most memory?", { intent: "usage", topPodBy: "memory" }],
  ["how are the nodes doing?", { intent: "nodes" }],
  ["full status of prod", { intent: "status", environment: "prod" }],
  ["roll back staging", { intent: "rollback", environment: "staging" }],
  ["show my last 5 deployments", { intent: "history", limit: 5, mine: true }],

  // Other ways of saying the same things
  ["deploy v2 to prod", { intent: "deploy", version: "v2", environment: "prod" }],
  ["deploy sample-app:v2 to staging", { intent: "deploy", app: "sample-app", version: "v2", environment: "staging" }],
  ["Deploy 1.4.0 to staging", { intent: "deploy", version: "1.4.0", environment: "staging" }],
  ["please deploy version 2026-10-12_b7 to staging", { intent: "deploy", version: "2026-10-12_b7", environment: "staging" }],
  ["deploy latest to staging", { intent: "deploy", version: "latest", environment: "staging" }],
  ["deploy it", { intent: "deploy" }],
  ["rollback prod", { intent: "rollback", environment: "prod" }],
  ["scale staging to 5 replicas", { intent: "scale", environment: "staging", replicas: 5 }],
  ["scale prod to 2", { intent: "scale", environment: "prod", replicas: 2 }],
  ["set sample-app to 4 replicas in staging", { intent: "scale", app: "sample-app", environment: "staging", replicas: 4 }],
  ["is prod up?", { intent: "health", environment: "prod" }],
  ["is production healthy?", { intent: "health", environment: "prod" }],
  ["memory usage in staging", { intent: "usage", environment: "staging" }],
  ["which pod uses the most cpu in prod", { intent: "usage", environment: "prod", topPodBy: "cpu" }],
  ["status of staging", { intent: "status", environment: "staging" }],
  ["list deployments", { intent: "history" }],
  ["deployment history for prod", { intent: "history", environment: "prod" }],
  ["help", { intent: "help" }],
  ["what can you do?", { intent: "help" }],

  // Services made in the chat
  ["create a service", { intent: "create" }],
  ["I want to create a new service in staging", { intent: "create", environment: "staging" }],
  ["add a new service", { intent: "create" }],
  ["new app please", { intent: "create" }],
  ["edit sample-app in staging", { intent: "edit", app: "sample-app", environment: "staging" }],
  ["change the settings of sample-app", { intent: "edit", app: "sample-app" }],

  // Answers and follow-ups carry details but no intent of their own
  ["what about prod?", { intent: null, environment: "prod" }],
  ["staging", { intent: null, environment: "staging" }],
  ["v3", { intent: null, version: "v3" }],
  ["v2 to staging", { intent: null, version: "v2", environment: "staging" }],
  ["5", { intent: null, replicas: 5 }],

  // Nothing recognised
  ["tell me a joke", { intent: null }],
];

for (const [message, expected] of cases) {
  test(`"${message}"`, () => {
    assert.deepEqual(parseMessage(message, known), expected);
  });
}

test("a version keeps its capital letters, because image tags are case-sensitive", () => {
  assert.equal(parseMessage("DEPLOY Version RC1-Final TO Staging", known).version, "RC1-Final");
});

test("an environment that does not exist is reported by name instead of being ignored", () => {
  assert.deepEqual(parseMessage("deploy v2 to qa", known), {
    intent: "deploy",
    version: "v2",
    unknownEnvironment: "qa",
  });
  assert.equal(parseMessage("full status of dev", known).unknownEnvironment, "dev");
});

// ---- Typing mistakes in the name of an environment ----

const misspelled: [message: string, environment: string][] = [
  ["deploy v2 to stagin", "staging"], // a letter is missing
  ["deploy v2 to stagging", "staging"], // a letter too many
  ["deploy v2 to stagimg", "staging"], // a wrong letter
  ["deploy v2 to satging", "staging"], // two neighbours swapped
  ["is prodution healthy?", "prod"], // "production" is another word for prod
];
for (const [message, environment] of misspelled) {
  test(`"${message}" means ${environment}`, () => {
    const parsed = parseMessage(message, known);

    assert.equal(parsed.environment, environment);
    assert.equal(parsed.unknownEnvironment, undefined);
  });
}

test("a name with two typing mistakes is not guessed", () => {
  assert.deepEqual(parseMessage("deploy v2 to stagn", known), {
    intent: "deploy",
    version: "v2",
    unknownEnvironment: "stagn",
  });
});

test("a short name must be spelled right, because one letter off is often another word", () => {
  // "pod" is "prod" with one letter missing, but it is a word of its own.
  assert.deepEqual(parseMessage("which pod uses the most cpu", known), { intent: "usage", topPodBy: "cpu" });
  assert.equal(parseMessage("deploy v2 to prd", known).unknownEnvironment, "prd");
});

test("a word that is one mistake away from two environments is not guessed", () => {
  const twoStages = { environments: ["stage-a", "stage-b"], apps: ["sample-app"] };

  assert.equal(parseMessage("deploy v2 to stage-c", twoStages).environment, undefined);
});

test("a question about a deploy is read as a question, not as an order to deploy", () => {
  assert.equal(parseMessage("is the deploy healthy in staging?", known).intent, "health");
});

// ---- The cards the page shows ----

test("every card the page shows is a request the rules understand, so it works without OpenAI", () => {
  const cards = [...buildCapabilities([{ environment: "staging", app: "sample-app" }]), ...buildCapabilities([])];

  for (const card of cards) {
    assert.notEqual(parseMessage(card.example, known).intent, null, card.example);
  }
});
