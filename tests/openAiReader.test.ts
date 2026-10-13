import assert from "node:assert/strict";
import { test } from "node:test";

import { parseMessage } from "@/agent/intentParser.ts";
import type { ParsedMessage } from "@/types/agent.ts";
import { createOpenAiReader, toParsedMessage } from "@/agent/openAiReader.ts";
import type { ModelRequest, ToolCall } from "@/types/llm.ts";
import { ModelUnavailableError } from "@/errors.ts";

const known = { environments: ["staging", "prod"], apps: ["sample-app"] };

// ---- From the tool the model picked to the request the Agent works with ----

const understood: [message: string, picked: ToolCall, expected: ParsedMessage][] = [
  [
    "push sample-app v2 out to staging",
    { name: "deploy", args: { app: "sample-app", version: "v2", environment: "staging" } },
    { intent: "deploy", app: "sample-app", version: "v2", environment: "staging" },
  ],
  [
    "bump staging up to five pods",
    { name: "scale", args: { app: null, environment: "staging", replicas: 5 } },
    { intent: "scale", environment: "staging", replicas: 5 },
  ],
  [
    "undo the last release on prod",
    { name: "roll_back", args: { app: null, environment: "prod" } },
    { intent: "rollback", environment: "prod" },
  ],
  [
    "is everything alright in production?",
    { name: "check_health", args: { app: null, environment: "production" } },
    { intent: "health", environment: "prod" },
  ],
  [
    "what is eating the most memory on staging",
    { name: "show_usage", args: { app: null, environment: "staging", topPodBy: "memory" } },
    { intent: "usage", environment: "staging", topPodBy: "memory" },
  ],
  ["are the machines okay?", { name: "show_nodes", args: {} }, { intent: "nodes" }],
  [
    "give me the whole picture for prod",
    { name: "full_status", args: { app: null, environment: "prod" } },
    { intent: "status", environment: "prod" },
  ],
  [
    "what did I ship lately? the last 3",
    { name: "list_deployments", args: { environment: null, limit: 3, mine: true } },
    { intent: "history", limit: 3, mine: true },
  ],
  ["what are you able to do", { name: "show_help", args: {} }, { intent: "help" }],
  [
    "the staging one please",
    { name: "give_details", args: { app: null, environment: "staging", version: null, replicas: null } },
    { intent: null, environment: "staging" },
  ],
  ["tell me a joke", { name: "not_understood", args: {} }, { intent: null }],
];

for (const [message, picked, expected] of understood) {
  test(`"${message}" read as ${picked.name}`, () => {
    assert.deepEqual(toParsedMessage(picked, message, known), expected);
  });
}

// ---- What the model says is checked before it is used ----

test("an environment the user did not write is dropped, so the Agent asks for it", () => {
  const picked = { name: "deploy", args: { app: null, version: "v2", environment: "prod" } };

  assert.deepEqual(toParsedMessage(picked, "push v2 live", known), { intent: "deploy", version: "v2" });
});

test("an environment is dropped when the rules read a different one in the message", () => {
  const picked = { name: "deploy", args: { app: null, version: "v2", environment: "prod" } };

  assert.deepEqual(toParsedMessage(picked, "deploy v2 to prod, not staging", known), { intent: "deploy", version: "v2" });
});

test("an environment that does not exist is reported by the name the user wrote", () => {
  const picked = { name: "deploy", args: { app: null, version: "v2", environment: "QA" } };

  assert.deepEqual(toParsedMessage(picked, "ship v2 to the qa cluster", known), {
    intent: "deploy",
    version: "v2",
    unknownEnvironment: "qa",
  });
});

test("an environment the user wrote with a typing mistake is read as the one that was meant", () => {
  const picked = { name: "check_health", args: { app: null, environment: "stagin" } };

  assert.deepEqual(toParsedMessage(picked, "is stagin helthy?", known), { intent: "health", environment: "staging" });
});

test("an environment whose spelling the model corrected still counts as written by the user", () => {
  const picked = { name: "full_status", args: { app: null, environment: "prod" } };

  assert.deepEqual(toParsedMessage(picked, "whats the staus of prodution", known), {
    intent: "status",
    environment: "prod",
  });
});

test("a short environment name is not guessed from a word that looks like it", () => {
  const picked = { name: "show_usage", args: { app: null, environment: "prod", topPodBy: "cpu" } };

  assert.deepEqual(toParsedMessage(picked, "which pod uses the most cpu", known), { intent: "usage", topPodBy: "cpu" });
});

test("an unknown environment the user did not write is dropped", () => {
  const picked = { name: "deploy", args: { app: null, version: "v2", environment: "qa" } };

  assert.deepEqual(toParsedMessage(picked, "ship v2", known), { intent: "deploy", version: "v2" });
});

test("a version the user did not write is dropped: the model may not invent one", () => {
  const picked = { name: "deploy", args: { app: null, version: "v2", environment: "staging" } };

  assert.deepEqual(toParsedMessage(picked, "deploy the second version to staging", known), {
    intent: "deploy",
    environment: "staging",
  });
});

test("a version is taken in the user's own spelling", () => {
  const picked = { name: "deploy", args: { app: null, version: "v2-rc1", environment: "staging" } };

  assert.equal(toParsedMessage(picked, "Deploy V2-RC1 to staging", known)?.version, "V2-RC1");
});

test("a version with characters an image tag cannot have is dropped", () => {
  const picked = { name: "deploy", args: { app: null, version: "v2;reboot", environment: "staging" } };

  assert.deepEqual(toParsedMessage(picked, "deploy v2;reboot to staging", known), {
    intent: "deploy",
    environment: "staging",
  });
});

test("an app that is not in the config file is dropped", () => {
  const picked = { name: "check_health", args: { app: "billing", environment: "staging" } };

  assert.deepEqual(toParsedMessage(picked, "is billing fine on staging?", known), {
    intent: "health",
    environment: "staging",
  });
});

test("replicas must be a whole number, 0 or more", () => {
  for (const replicas of [2.5, -1, "5", true]) {
    const picked = { name: "scale", args: { app: null, environment: "staging", replicas } };

    assert.deepEqual(toParsedMessage(picked, "scale staging", known), { intent: "scale", environment: "staging" });
  }
});

test("a detail that does not belong to the picked tool is ignored", () => {
  const picked = { name: "check_health", args: { app: null, environment: "staging", replicas: 0, version: "v9" } };

  assert.deepEqual(toParsedMessage(picked, "is staging ok? v9", known), { intent: "health", environment: "staging" });
});

test("a tool that is not on the list is not usable", () => {
  assert.equal(toParsedMessage({ name: "delete_namespace", args: { environment: "prod" } }, "delete prod", known), null);
});

test("details that are not an object are not usable", () => {
  assert.equal(toParsedMessage({ name: "deploy", args: "staging" }, "deploy to staging", known), null);
});

// ---- Answers to a question the assistant asked ----

const openDeploy: ParsedMessage = { intent: "deploy", app: "sample-app", version: "v2" };

test("an answer that repeats the action of the open question counts as an answer", () => {
  const picked = { name: "deploy", args: { app: null, version: null, environment: "staging" } };

  assert.deepEqual(toParsedMessage(picked, "put it on staging", known, openDeploy), {
    intent: null,
    environment: "staging",
  });
});

test("the same action without any detail is left as it is", () => {
  const picked = { name: "deploy", args: { app: null, version: null, environment: null } };

  assert.deepEqual(toParsedMessage(picked, "just deploy it", known, openDeploy), { intent: "deploy" });
});

test("a different action than the open question stands on its own", () => {
  assert.deepEqual(toParsedMessage({ name: "show_nodes", args: {} }, "how are the nodes", known, openDeploy), {
    intent: "nodes",
  });
});

// ---- The workflow: ask the model, check the answer, or fall back to the rules ----

const NODES: ToolCall = { name: "show_nodes", args: {} };

/** A reader whose model gives the listed answers in order. An Error in the list is thrown. */
function setup(answers: (ToolCall | Error)[]) {
  const requests: ModelRequest[] = [];
  const logged: unknown[][] = [];
  let nowMs = Date.parse("2026-10-13T08:00:00Z");
  const reader = createOpenAiReader({
    known,
    model: "test-model",
    retryAfterSeconds: 60,
    askModel: async (request) => {
      requests.push(request);
      const answer = answers.shift();
      if (answer === undefined) {
        throw new Error("the test gave the model no more answers");
      }
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    },
    now: () => nowMs,
    log: (...parts) => logged.push(parts),
  });
  return {
    reader,
    requests,
    logged,
    passSeconds: (seconds: number) => {
      nowMs += seconds * 1000;
    },
  };
}

test("a message the model understands is returned as the model read it, without a note", async () => {
  const { reader } = setup([{ name: "scale", args: { app: null, environment: "staging", replicas: 5 } }]);

  const reading = await reader.read("bump staging up to five pods");

  assert.deepEqual(reading, { parsed: { intent: "scale", environment: "staging", replicas: 5 } });
});

test("the model is given the known names, the message and a fixed list of tools", async () => {
  const { reader, requests } = setup([NODES]);

  await reader.read("are the machines okay?");

  const request = requests[0];
  assert.ok(request.instructions.includes("Environments: staging, prod."), request.instructions);
  assert.ok(request.instructions.includes("Apps: sample-app."), request.instructions);
  assert.equal(request.message, "Message: are the machines okay?");
  assert.deepEqual(
    request.tools.map((tool) => tool.name),
    ["deploy", "scale", "roll_back", "check_health", "show_usage", "show_nodes", "full_status", "list_deployments", "show_help", "give_details", "not_understood"],
  );
});

test("every tool lists exactly its own details, so the model cannot add others", async () => {
  const { reader, requests } = setup([NODES]);

  await reader.read("are the machines okay?");

  for (const tool of requests[0].tools) {
    const { properties, required, additionalProperties } = tool.parameters;
    assert.deepEqual(required, Object.keys(properties), tool.name);
    assert.equal(additionalProperties, false, tool.name);
  }
  const scale = requests[0].tools.find((tool) => tool.name === "scale");
  assert.deepEqual(Object.keys(scale?.parameters.properties ?? {}), ["app", "environment", "replicas"]);
});

test("every detail can be left empty, also one with a fixed list of values", async () => {
  const { reader, requests } = setup([NODES]);

  await reader.read("are the machines okay?");

  for (const tool of requests[0].tools) {
    for (const [detail, schema] of Object.entries(tool.parameters.properties)) {
      const { type, enum: values } = schema as { type: string[]; enum?: unknown[] };
      assert.ok(type.includes("null"), `${tool.name}.${detail}`);
      // Without null in the list the model has to pick a value, even when the user gave none.
      assert.ok(values === undefined || values.includes(null), `${tool.name}.${detail}`);
    }
  }
});

test("the model is told that messages can have typing mistakes", async () => {
  const { reader, requests } = setup([NODES]);

  await reader.read("are the machines okay?");

  assert.ok(requests[0].instructions.includes("typing mistakes"), requests[0].instructions);
});

test("an open question is passed to the model together with the answer", async () => {
  const { reader, requests } = setup([{ name: "give_details", args: { app: null, environment: "staging", version: null, replicas: null } }]);

  const reading = await reader.read("the staging one please", openDeploy);

  assert.equal(
    requests[0].message,
    'The assistant asked the user for the missing details of this unfinished request: {"intent":"deploy","app":"sample-app","version":"v2"}\nMessage: the staging one please',
  );
  assert.deepEqual(reading.parsed, { intent: null, environment: "staging" });
});

test("when the call fails, the rules read the message and the reading says why", async () => {
  const { reader } = setup([new ModelUnavailableError("OpenAI rejected the API key.")]);
  const message = "deploy sample-app version v2 to staging";

  const reading = await reader.read(message);

  assert.deepEqual(reading.parsed, parseMessage(message, known));
  assert.equal(reading.fallbackNote, "OpenAI rejected the API key. I read this message with my built-in rules instead.");
});

test("an answer that is not usable sends the message to the rules", async () => {
  const { reader } = setup([{ name: "delete_namespace", args: { environment: "prod" } }]);

  const reading = await reader.read("is prod up?");

  assert.deepEqual(reading.parsed, { intent: "health", environment: "prod" });
  assert.equal(reading.fallbackNote, "OpenAI's answer was not usable. I read this message with my built-in rules instead.");
});

test("an unexpected error in the call still ends with the rules reading the message", async () => {
  const { reader, logged } = setup([new Error("boom")]);

  const reading = await reader.read("roll back staging");

  assert.deepEqual(reading.parsed, { intent: "rollback", environment: "staging" });
  assert.equal(
    reading.fallbackNote,
    "OpenAI could not be used because of an unexpected error. I read this message with my built-in rules instead.",
  );
  assert.equal(logged.length, 1);
});

test("after a failure the model is left alone until the pause is over", async () => {
  const { reader, requests, passSeconds } = setup([new ModelUnavailableError("I could not reach OpenAI."), NODES]);
  await reader.read("is prod up?");

  passSeconds(59);
  const duringPause = await reader.read("how are the nodes doing?");

  assert.equal(requests.length, 1, "the model must not be asked during the pause");
  assert.deepEqual(duringPause.parsed, { intent: "nodes" });
  assert.equal(duringPause.fallbackNote, "I could not reach OpenAI. I read this message with my built-in rules instead.");

  passSeconds(2);
  const afterPause = await reader.read("are the machines okay?");

  assert.equal(requests.length, 2);
  assert.deepEqual(afterPause, { parsed: { intent: "nodes" } });
});

test("an unusable answer is about one message only: the next message goes to the model again", async () => {
  const { reader, requests } = setup([{ name: "delete_namespace", args: {} }, NODES]);
  await reader.read("wipe everything");

  const next = await reader.read("are the machines okay?");

  assert.equal(requests.length, 2);
  assert.deepEqual(next, { parsed: { intent: "nodes" } });
});

test("a failure is written to the server log once, not for every message during the pause", async () => {
  const { reader, logged } = setup([new ModelUnavailableError("OpenAI did not answer within 8 seconds.")]);

  await reader.read("is prod up?");
  await reader.read("is staging up?");

  assert.equal(logged.length, 1);
});

test("the description names the model and the fallback", () => {
  const { reader } = setup([]);

  assert.equal(
    reader.description,
    "Messages are read by OpenAI (test-model). If it is unavailable, built-in rules read them instead.",
  );
});
