import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";

import { Agent } from "@/agent/agent.ts";
import { SessionStore } from "@/agent/sessionStore.ts";
import { createApp } from "@/api/routes.ts";
import { loadConfig } from "@/config.ts";
import { DeploymentService } from "@/services/deploymentService.ts";
import { FailureExplainer } from "@/services/failureExplainer.ts";
import { HistoryStore } from "@/services/historyStore.ts";
import { MetricsService } from "@/services/metricsService.ts";
import { OperationStore } from "@/services/operationStore.ts";
import { StatusService } from "@/services/statusService.ts";
import { FakeGateway } from "./helpers/fakeGateway.ts";

const servers: Server[] = [];
after(() => {
  for (const server of servers) {
    server.close();
  }
});

interface Answer {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- test helper: JSON of any shape
}

/** The real web app on a free port, on top of a pretend cluster with sample-app v1 in staging. */
async function setup() {
  const gateway = new FakeGateway();
  gateway.seed("staging", "sample-app", "sample-app:v1", 3);
  const config = loadConfig("config/app.config.yaml");
  const history = new HistoryStore(":memory:", "fake-cluster");
  const operations = new OperationStore();
  const explainer = new FailureExplainer(gateway);
  const sessions = new SessionStore();
  const statuses = new StatusService({ gateway, history, config, explainer, metrics: new MetricsService(gateway) });
  const agent = new Agent({
    config,
    history,
    sessions,
    statuses,
    deployments: new DeploymentService({ gateway, history, operations, config, explainer, sleep: async () => {} }),
  });
  const app = createApp({ agent, operations, statuses, sessions, logError: () => {} });
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function call(method: string, path: string, options: { body?: unknown; session?: string | null; user?: string; rawBody?: string } = {}): Promise<Answer> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (options.session !== null) {
      headers["X-Session-Id"] = options.session ?? "tab-session-1";
    }
    if (options.user !== undefined) {
      headers["X-User-Name"] = options.user;
    }
    const response = await fetch(baseUrl + path, {
      method,
      headers,
      body: options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    });
    return { status: response.status, body: await response.json() };
  }

  return { gateway, history, call };
}

test("a chat message is answered, and a change comes back with something to confirm", async () => {
  const { call, gateway } = await setup();

  const answer = await call("POST", "/api/chat", { body: { message: "deploy sample-app version v2 to staging" } });

  assert.equal(answer.status, 200);
  assert.ok(answer.body.reply.text.includes("to image sample-app:v2"));
  assert.equal(typeof answer.body.reply.action.id, "string");
  assert.deepEqual(gateway.writes, []);
});

test("confirming starts the change, and its progress can be read until it has finished", async () => {
  const { call, gateway, history } = await setup();
  const chat = await call("POST", "/api/chat", { body: { message: "deploy v2 to staging" }, user: "asha" });

  const confirm = await call("POST", `/api/actions/${chat.body.reply.action.id}/confirm`, { user: "asha" });
  assert.equal(confirm.status, 200);
  assert.equal(confirm.body.reply.text, "Rolling update started (dep-001).");

  let operation;
  for (let attempt = 0; attempt < 50; attempt++) {
    operation = (await call("GET", `/api/operations/${confirm.body.reply.operationId}`)).body.operation;
    if (operation.state !== "running") {
      break;
    }
  }
  assert.equal(operation.state, "succeeded");
  assert.deepEqual(operation.steps, ["1/3 pods ready", "2/3 pods ready", "3/3 pods ready"]);
  assert.equal(operation.message, "3/3 pods ready. Deployment ID: dep-001");
  assert.ok(gateway.writes.includes("applyDeployment staging sample-app:v2 x3"));
  assert.equal(history.list({ limit: 1 })[0]?.requestedBy, "asha");
});

test("cancelling answers that nothing was changed", async () => {
  const { call, gateway } = await setup();
  const chat = await call("POST", "/api/chat", { body: { message: "deploy v2 to staging" } });

  const cancel = await call("POST", `/api/actions/${chat.body.reply.action.id}/cancel`);

  assert.equal(cancel.body.reply.text, "Cancelled. Nothing was changed.");
  assert.deepEqual(gateway.writes, []);
});

test("a different session cannot confirm the action", async () => {
  const { call, gateway } = await setup();
  const chat = await call("POST", "/api/chat", { body: { message: "deploy v2 to staging" }, session: "tab-session-1" });

  const confirm = await call("POST", `/api/actions/${chat.body.reply.action.id}/confirm`, { session: "tab-session-2" });

  assert.equal(confirm.body.reply.text, "That confirmation is no longer valid. Please ask again.");
  assert.deepEqual(gateway.writes, []);
});

test("the session endpoint returns the tab's conversation and which action is still open", async () => {
  const { call } = await setup();
  const chat = await call("POST", "/api/chat", { body: { message: "deploy v2 to staging" } });

  const own = await call("GET", "/api/session");
  const other = await call("GET", "/api/session", { session: "tab-session-2" });

  assert.equal(own.body.messages.length, 2);
  assert.equal(own.body.messages[0].text, "deploy v2 to staging");
  assert.equal(own.body.pendingActionId, chat.body.reply.action.id);
  assert.deepEqual(other.body, { messages: [], pendingActionId: null });
});

test("the status endpoint lists every environment", async () => {
  const { call } = await setup();

  const answer = await call("GET", "/api/status");

  assert.equal(answer.status, 200);
  assert.deepEqual(
    answer.body.environments.map((entry: { environment: string; status: string }) => [entry.environment, entry.status]),
    [
      ["staging", "HEALTHY"],
      ["prod", "NOT DEPLOYED"],
    ],
  );
});

test("an unknown operation is 404 with a clear message", async () => {
  const { call } = await setup();

  const answer = await call("GET", "/api/operations/no-such-operation");

  assert.equal(answer.status, 404);
  assert.equal(answer.body.error, "That operation is not known. It may be too old.");
});

test("a request without a session ID is refused", async () => {
  const { call } = await setup();

  const answer = await call("POST", "/api/chat", { body: { message: "help" }, session: null });

  assert.equal(answer.status, 400);
  assert.equal(answer.body.error, "The X-Session-Id header is missing or not valid.");
});

test("an empty or oversized message is refused", async () => {
  const { call } = await setup();

  assert.equal((await call("POST", "/api/chat", { body: { message: "   " } })).status, 400);
  assert.equal((await call("POST", "/api/chat", { body: {} })).status, 400);
  const tooLong = await call("POST", "/api/chat", { body: { message: "x".repeat(501) } });
  assert.equal(tooLong.body.error, "Type a message of at most 500 characters.");
});

test("a body that is not JSON is refused without a stack trace", async () => {
  const { call } = await setup();

  const answer = await call("POST", "/api/chat", { rawBody: "{not json" });

  assert.equal(answer.status, 400);
  assert.equal(answer.body.error, "The request body is not valid JSON.");
});

test("an unexpected server error shows a reference and none of its details", async () => {
  const { call, gateway } = await setup();
  gateway.failNext("getDeployment", new Error("boom in /Users/someone/secret/path.ts:12"));

  const answer = await call("POST", "/api/chat", { body: { message: "is staging healthy?" } });

  assert.equal(answer.status, 500);
  assert.match(answer.body.error, /^Something went wrong on the server \(reference [0-9a-f]{8}\)/);
  assert.ok(!JSON.stringify(answer.body).includes("boom"));
  assert.ok(!JSON.stringify(answer.body).includes("secret"));
});
