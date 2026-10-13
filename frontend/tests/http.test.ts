import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";

import { callApi, messageOf } from "@/lib/http.ts";

const identity = { sessionId: "tab-12345678", userName: "suhail" };

/** Replaces fetch for one test and remembers what it was called with. */
function stubFetch(t: TestContext, answer: () => Promise<Response>) {
  return t.mock.method(globalThis, "fetch", answer);
}

test("returns the JSON body of a successful answer", async (t) => {
  stubFetch(t, async () => Response.json({ reply: { text: "staging is HEALTHY." } }));

  const data = await callApi<{ reply: { text: string } }>("POST", "/api/chat", identity, { message: "is it healthy?" });

  assert.deepEqual(data, { reply: { text: "staging is HEALTHY." } });
});

test("sends the session ID and the user name as headers", async (t) => {
  const fetchStub = stubFetch(t, async () => Response.json({}));

  await callApi("GET", "/api/status", identity);

  const [path, options] = fetchStub.mock.calls[0]!.arguments as [string, RequestInit];
  assert.equal(path, "/api/status");
  assert.equal(options.method, "GET");
  assert.deepEqual(options.headers, {
    "Content-Type": "application/json",
    "X-Session-Id": "tab-12345678",
    "X-User-Name": "suhail",
  });
});

test("sends the body as JSON", async (t) => {
  const fetchStub = stubFetch(t, async () => Response.json({}));

  await callApi("POST", "/api/chat", identity, { message: "roll back staging" });

  const [, options] = fetchStub.mock.calls[0]!.arguments as [string, RequestInit];
  assert.equal(options.body, '{"message":"roll back staging"}');
});

test("sends no body when none is given", async (t) => {
  const fetchStub = stubFetch(t, async () => Response.json({}));

  await callApi("GET", "/api/session", identity);

  const [, options] = fetchStub.mock.calls[0]!.arguments as [string, RequestInit];
  assert.equal(options.body, undefined);
});

test("throws the server's own sentence when the answer is an error", async (t) => {
  stubFetch(t, async () =>
    Response.json({ error: "A deployment to staging is already in progress." }, { status: 409 }),
  );

  await assert.rejects(callApi("POST", "/api/actions/abc/confirm", identity), {
    message: "A deployment to staging is already in progress.",
  });
});

test("names the status when an error answer carries no sentence", async (t) => {
  stubFetch(t, async () => new Response("<html>Bad Gateway</html>", { status: 502 }));

  await assert.rejects(callApi("GET", "/api/status", identity), {
    message: "The server answered with status 502.",
  });
});

test("says the server is not answering when the request cannot be sent", async (t) => {
  stubFetch(t, async () => {
    throw new TypeError("fetch failed");
  });

  await assert.rejects(callApi("GET", "/api/status", identity), {
    message: "The Deployment Assistant server is not answering. Is it still running?",
  });
});

test("messageOf returns the sentence of an Error", () => {
  assert.equal(messageOf(new Error("I can't reach the cluster.")), "I can't reach the cluster.");
});

test("messageOf turns anything else that was thrown into text", () => {
  assert.equal(messageOf("timed out"), "timed out");
});
