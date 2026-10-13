import assert from "node:assert/strict";
import { test } from "node:test";

import { createOpenAiModel } from "../src/agent/openAiModel.ts";
import type { ModelRequest } from "../src/agent/openAiReader.ts";
import { ModelUnavailableError } from "../src/errors.ts";

// These tests run the real OpenAI library, but replace the network call underneath it,
// so nothing is sent to OpenAI and no API key is needed.

const API_KEY = "sk-test-not-a-real-key";

const REQUEST: ModelRequest = {
  instructions: "Pick one tool.",
  message: "Message: bump staging up to five pods",
  tools: [
    {
      name: "scale",
      description: "Change how many replicas an app runs.",
      parameters: {
        type: "object",
        properties: { environment: { type: ["string", "null"] }, replicas: { type: ["integer", "null"] } },
        required: ["environment", "replicas"],
        additionalProperties: false,
      },
    },
  ],
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** An answer from OpenAI in which the model picked the given tools. */
function picked(...calls: { name: string; arguments: string }[]): Response {
  return json(200, {
    id: "chatcmpl-1",
    object: "chat.completion",
    created: 1,
    model: "test-model",
    choices: [
      {
        index: 0,
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          refusal: null,
          tool_calls: calls.map((call, index) => ({ id: `call_${index}`, type: "function", function: call })),
        },
      },
    ],
  });
}

function refused(status: number, code: string): Response {
  return json(status, { error: { message: `details from OpenAI about ${code}`, type: "invalid_request_error", code } });
}

/** A model whose network call is answered by `respond`. Records what was sent. */
function setup(respond: (signal: AbortSignal) => Promise<Response>, timeoutMs = 8000) {
  const sent: { url: string; authorization: string | null; body: any }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any -- test helper: JSON of any shape
  const askModel = createOpenAiModel({
    apiKey: API_KEY,
    model: "test-model",
    timeoutMs,
    fetch: async (url, init) => {
      sent.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body)),
      });
      return respond(init?.signal as AbortSignal);
    },
  });
  return { askModel, sent };
}

/** The error the call ends with. */
async function failureOf(askModel: (request: ModelRequest) => Promise<unknown>): Promise<ModelUnavailableError> {
  try {
    await askModel(REQUEST);
  } catch (error) {
    assert.ok(error instanceof ModelUnavailableError, `expected a ModelUnavailableError, got ${String(error)}`);
    return error;
  }
  throw new Error("the call should have failed");
}

test("the request names the model, both texts and the tools, and demands that one tool is picked", async () => {
  const { askModel, sent } = setup(async () => picked({ name: "scale", arguments: "{}" }));

  await askModel(REQUEST);

  assert.equal(sent.length, 1);
  assert.ok(sent[0].url.endsWith("/chat/completions"), sent[0].url);
  assert.equal(sent[0].authorization, `Bearer ${API_KEY}`);
  assert.equal(sent[0].body.model, "test-model");
  assert.deepEqual(sent[0].body.messages, [
    { role: "system", content: "Pick one tool." },
    { role: "user", content: "Message: bump staging up to five pods" },
  ]);
  assert.equal(sent[0].body.tool_choice, "required");
  assert.deepEqual(sent[0].body.tools, [
    { type: "function", function: { ...REQUEST.tools[0], strict: true } },
  ]);
});

test("the tool the model picked comes back with its details", async () => {
  const { askModel } = setup(async () => picked({ name: "scale", arguments: '{"environment":"staging","replicas":5}' }));

  assert.deepEqual(await askModel(REQUEST), { name: "scale", args: { environment: "staging", replicas: 5 } });
});

test("one message is one action: only the first picked tool counts", async () => {
  const { askModel } = setup(async () =>
    picked({ name: "scale", arguments: '{"environment":"staging","replicas":5}' }, { name: "deploy", arguments: "{}" }),
  );

  assert.equal((await askModel(REQUEST)).name, "scale");
});

const refusals: [status: number, code: string, sentence: string][] = [
  [401, "invalid_api_key", "OpenAI rejected the API key."],
  [403, "model_not_allowed", 'This OpenAI API key is not allowed to use the model "test-model".'],
  [404, "model_not_found", 'OpenAI does not know the model "test-model". Check llm.model in the config file.'],
  [429, "insufficient_quota", "OpenAI is refusing requests right now (rate limit reached or no credit left)."],
  [500, "server_error", "OpenAI had a problem on its side."],
  [503, "overloaded", "OpenAI had a problem on its side."],
  [400, "invalid_request", "OpenAI refused the request."],
];

for (const [status, code, sentence] of refusals) {
  test(`HTTP ${status} from OpenAI is reported as: ${sentence}`, async () => {
    const { askModel, sent } = setup(async () => refused(status, code));

    const failure = await failureOf(askModel);

    assert.equal(failure.message, sentence);
    assert.ok(failure.detail.startsWith(`HTTP ${status}, ${code}`), failure.detail);
    assert.equal(sent.length, 1, "a failed call must not be repeated: the rules are the retry");
  });
}

test("a network that is down is reported as not reaching OpenAI", async () => {
  const { askModel, sent } = setup(async () => {
    throw new TypeError("fetch failed");
  });

  assert.equal((await failureOf(askModel)).message, "I could not reach OpenAI.");
  assert.equal(sent.length, 1);
});

test("a call that takes longer than the timeout is given up", async () => {
  const { askModel } = setup(
    (signal) =>
      // Never answers; ends only when the library gives up and cancels the call.
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("This operation was aborted", "AbortError")));
      }),
    50,
  );

  assert.equal((await failureOf(askModel)).message, "OpenAI did not answer within 0.05 seconds.");
});

test("an answer in which no tool was picked is not usable", async () => {
  const { askModel } = setup(async () => picked());

  assert.equal((await failureOf(askModel)).message, "OpenAI's answer was not usable.");
});

test("details that are not valid JSON are not usable", async () => {
  const { askModel } = setup(async () => picked({ name: "scale", arguments: '{"environment": "stag' }));

  assert.equal((await failureOf(askModel)).message, "OpenAI's answer was not usable.");
});

test("OpenAI's own explanation goes to the server log, so a refused request can be fixed", async () => {
  const { askModel } = setup(async () => refused(400, "invalid_function_parameters"));

  const failure = await failureOf(askModel);

  assert.ok(failure.detail.includes("details from OpenAI about invalid_function_parameters"), failure.detail);
});

test("for a rejected key OpenAI's explanation is left out, because it repeats part of the key", async () => {
  const { askModel } = setup(async () =>
    json(401, { error: { message: `Incorrect API key provided: ${API_KEY}.`, type: "invalid_request_error", code: "invalid_api_key" } }),
  );

  const failure = await failureOf(askModel);

  assert.equal(failure.detail, "HTTP 401, invalid_api_key");
  assert.ok(!`${failure.message} ${failure.detail}`.includes(API_KEY));
});
