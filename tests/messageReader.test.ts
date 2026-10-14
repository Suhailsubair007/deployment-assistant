import assert from "node:assert/strict";
import { test } from "node:test";

import { parseMessage } from "@/agent/intentParser.ts";
import { createMessageReader, createRuleReader } from "@/agent/messageReader.ts";

const known = { environments: ["staging", "prod"], apps: ["sample-app"] };
const llm = { model: "gpt-4.1-mini", requestTimeoutMs: 8000, retryAfterSeconds: 60 };

const RULES_ONLY = "Messages are read by built-in rules. The LLM is not configured (OPENAI_API_KEY is not set).";

for (const [label, apiKey] of [["missing", undefined], ["empty", ""], ["only spaces", "   "]] as const) {
  test(`with a ${label} API key the rules read every message, and the description says so`, async () => {
    const reader = createMessageReader({ known, apiKey, llm });

    assert.equal(reader.description, RULES_ONLY);
    assert.deepEqual(await reader.read("deploy sample-app version v2 to staging"), {
      parsed: { intent: "deploy", app: "sample-app", version: "v2", environment: "staging" },
    });
  });
}

test("the rule reader gives exactly what the intent parser gives, without a note", async () => {
  const reader = createRuleReader(known);

  for (const message of ["roll back staging", "which pod is using the most memory?", "staging", "tell me a joke"]) {
    assert.deepEqual(await reader.read(message), { parsed: parseMessage(message, known) });
  }
});

test("with an API key the messages go to OpenAI, with the model named in the config file", () => {
  // Creating the reader sends nothing; OpenAI is only called when a message is read.
  const reader = createMessageReader({ known, apiKey: "sk-test-not-a-real-key", llm });

  assert.equal(
    reader.description,
    "Messages are read by OpenAI (gpt-4.1-mini), which also answers questions in plain words. If it is unavailable, built-in rules read them instead.",
  );
});
