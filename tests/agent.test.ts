import assert from "node:assert/strict";
import { test } from "node:test";

import { Agent } from "@/agent/agent.ts";
import type { ParsedMessage } from "@/types/agent.ts";
import type { MessageReader, Reading } from "@/types/agent.ts";
import { SessionStore } from "@/agent/sessionStore.ts";
import { loadConfig } from "@/config.ts";
import { ClusterUnreachableError, MetricsUnavailableError } from "@/errors.ts";
import { DeploymentService } from "@/services/deploymentService.ts";
import { FailureExplainer } from "@/services/failureExplainer.ts";
import { HistoryStore } from "@/services/historyStore.ts";
import { MetricsService } from "@/services/metricsService.ts";
import { OperationStore } from "@/services/operationStore.ts";
import { StatusService } from "@/services/statusService.ts";
import { FakeGateway } from "./helpers/fakeGateway.ts";

const TAB = "tab-1";
const DEPLOY_V2 = "deploy sample-app version v2 to staging";

/**
 * The real agent and services on top of a pretend cluster.
 * sample-app v1 runs in staging with 3 pods; prod is empty.
 *
 * @param reader how messages are read; left out, the agent uses the built-in rules
 */
async function setup(reader?: MessageReader) {
  const gateway = new FakeGateway();
  gateway.seed("staging", "sample-app", "sample-app:v1", 3);
  for (const pod of await gateway.listPods("staging", "sample-app")) {
    gateway.podUsage.set(pod.name, { cpu: "70m", memory: "127Mi" });
  }
  const config = loadConfig("config/app.config.yaml");
  const history = new HistoryStore(":memory:", "fake-cluster");
  const operations = new OperationStore();
  const explainer = new FailureExplainer(gateway);
  const sessions = new SessionStore();
  let nowMs = Date.parse("2026-10-12T12:00:00Z");
  const agent = new Agent({
    config,
    history,
    sessions,
    deployments: new DeploymentService({ gateway, history, operations, config, explainer, sleep: async () => {} }),
    statuses: new StatusService({ gateway, history, config, explainer, metrics: new MetricsService(gateway) }),
    now: () => nowMs,
    reader,
  });
  return {
    agent,
    gateway,
    history,
    operations,
    sessions,
    say: (text: string, tab = TAB, user = "asha") => agent.handleMessage(tab, text, user),
    passTime: (minutes: number) => {
      nowMs += minutes * 60_000;
    },
  };
}

/** Waits until a started change is no longer running. */
async function finished(operations: OperationStore, operationId: string | undefined) {
  assert.ok(operationId, "the reply should carry an operation ID");
  for (let turn = 0; turn < 200; turn++) {
    const operation = operations.get(operationId);
    if (operation !== null && operation.state !== "running") {
      return operation;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("the operation did not finish");
}

// ---- Nothing changes without Confirm ----

test("a deploy request is answered with a summary and changes nothing", async () => {
  const { say, gateway } = await setup();

  const reply = await say(DEPLOY_V2);

  assert.equal(
    reply.text,
    'I\'ll update deployment "sample-app" in namespace "staging" to image sample-app:v2 (3 replicas). It runs sample-app:v1 now.',
  );
  assert.ok(reply.action, "the reply should offer Confirm and Cancel");
  assert.equal(reply.action.warning, null);
  assert.deepEqual(gateway.writes, []);
});

test("Confirm starts the change and hands back an operation to follow", async () => {
  const { say, agent, gateway, operations } = await setup();
  const { action } = await say(DEPLOY_V2);

  const reply = await agent.confirm(TAB, action?.id ?? "", "asha");

  assert.equal(reply.text, "Rolling update started (dep-001).");
  const operation = await finished(operations, reply.operationId);
  assert.equal(operation.message, "3/3 pods ready. Deployment ID: dep-001");
  assert.deepEqual(gateway.writes, ["applyService staging sample-app", "applyDeployment staging sample-app:v2 x3"]);
});

test("a change to prod carries an extra warning; staging does not", async () => {
  const { say, gateway } = await setup();
  gateway.seed("prod", "sample-app", "sample-app:v1", 3);

  const reply = await say("deploy v2 to prod");

  assert.equal(
    reply.action?.warning,
    "Warning: prod is a protected environment. This change affects real users. Check the details before you confirm.",
  );
});

test("Cancel drops the change, and it cannot be confirmed afterwards", async () => {
  const { say, agent, gateway } = await setup();
  const { action } = await say(DEPLOY_V2);

  assert.equal(agent.cancel(TAB, action?.id ?? "").text, "Cancelled. Nothing was changed.");

  const late = await agent.confirm(TAB, action?.id ?? "", "asha");
  assert.equal(late.text, "That confirmation is no longer valid. Please ask again.");
  assert.deepEqual(gateway.writes, []);
});

test("a confirmation works only once", async () => {
  const { say, agent, operations } = await setup();
  const { action } = await say(DEPLOY_V2);
  await finished(operations, (await agent.confirm(TAB, action?.id ?? "", "asha")).operationId);

  const again = await agent.confirm(TAB, action?.id ?? "", "asha");

  assert.equal(again.text, "That confirmation is no longer valid. Please ask again.");
  assert.equal(again.operationId, undefined);
});

test("another tab cannot confirm this tab's change", async () => {
  const { say, agent, gateway } = await setup();
  const { action } = await say(DEPLOY_V2);

  const reply = await agent.confirm("tab-2", action?.id ?? "", "ravi");

  assert.equal(reply.text, "That confirmation is no longer valid. Please ask again.");
  assert.deepEqual(gateway.writes, []);
});

test("a confirmation expires after ten minutes", async () => {
  const { say, agent, gateway, passTime } = await setup();
  const { action } = await say(DEPLOY_V2);
  passTime(11);

  const reply = await agent.confirm(TAB, action?.id ?? "", "asha");

  assert.equal(reply.text, "That confirmation has expired. Please ask again.");
  assert.deepEqual(gateway.writes, []);
});

test("a refused start, such as a busy environment, is reported in the chat", async () => {
  const { say, agent, history } = await setup();
  history.start({ environment: "staging", app: "sample-app", action: "deploy", image: "sample-app:v5", previousImage: "sample-app:v1", replicas: 3, requestedBy: "ravi" });
  const { action } = await say(DEPLOY_V2);

  const reply = await agent.confirm(TAB, action?.id ?? "", "asha");

  assert.equal(
    reply.text,
    "staging already has a deployment in progress (dep-001, started by ravi). Try again when it finishes.",
  );
});

// ---- Asking instead of guessing ----

test('"deploy it" asks for the version and the environment', async () => {
  const { say } = await setup();

  const question = await say("deploy it");

  assert.equal(question.text, "Which version of sample-app should I deploy, and to which environment (staging or prod)?");
  assert.equal(question.action, undefined);

  const summary = await say("v2 to staging");
  assert.ok(summary.action);
  assert.ok(summary.text.includes("to image sample-app:v2"), summary.text);
});

test("missing details can be given one answer at a time", async () => {
  const { say } = await setup();
  await say("deploy it");

  assert.equal((await say("staging")).text, "Which version of sample-app should I deploy to staging? For example: v2");

  assert.ok((await say("v2")).action);
});

test("an environment that does not exist is named, and the request waits for a real one", async () => {
  const { say } = await setup();

  const reply = await say("deploy v2 to qa");

  assert.equal(reply.text, 'There is no environment called "qa". I know: staging, prod. Which one do you mean?');
  assert.ok((await say("staging")).action);
});

test("a change never borrows the environment from earlier messages", async () => {
  const { say } = await setup();
  await say("is staging healthy?");

  const reply = await say("roll back");

  assert.equal(reply.text, "Roll back sample-app in which environment: staging or prod?");
  assert.equal(reply.action, undefined);
});

test("rollback and scale are summarised before anything happens", async () => {
  const { say, agent, operations } = await setup();
  const { action } = await say(DEPLOY_V2);
  await finished(operations, (await agent.confirm(TAB, action?.id ?? "", "asha")).operationId);

  assert.equal((await say("roll back staging")).text, "Roll back sample-app in staging from sample-app:v2 to sample-app:v1?");
  assert.equal((await say("scale staging to 5 replicas")).text, "Scale sample-app in staging from 3 to 5 replicas?");
});

test("scale asks how many replicas when the number is missing", async () => {
  const { say } = await setup();

  assert.equal((await say("scale staging")).text, "How many replicas should sample-app have in staging?");
  assert.equal((await say("5")).text, "Scale sample-app in staging from 3 to 5 replicas?");
});

test("a refused request, such as the latest tag, is explained and offers nothing to confirm", async () => {
  const { say } = await setup();

  const reply = await say("deploy latest to staging");

  assert.ok(reply.text.startsWith('I don\'t deploy the "latest" tag'), reply.text);
  assert.equal(reply.action, undefined);
});

// ---- Questions and context ----

test("a question without an environment asks which one, in a new conversation", async () => {
  const { say } = await setup();

  assert.equal((await say("is it healthy?")).text, "Which environment: staging or prod?");
  assert.ok((await say("staging")).text.startsWith("sample-app (staging) is HEALTHY"));
});

test('"it" refers to the environment of the earlier question', async () => {
  const { say } = await setup();
  await say("is staging healthy?");

  const reply = await say("how much cpu and ram is it using?");

  assert.ok(reply.text.startsWith("sample-app (staging)\nCPU:    total 210m, avg 70m per pod (14% of 500m limit)"), reply.text);
});

test('"it" refers to the environment of the change just requested', async () => {
  const { say } = await setup();
  await say(DEPLOY_V2);

  assert.ok((await say("is it healthy?")).text.startsWith("sample-app (staging) is"));
});

test('"what about prod?" repeats the last question for prod', async () => {
  const { say, gateway } = await setup();
  gateway.seed("prod", "sample-app", "sample-app:v1", 2);
  await say("is staging healthy?");

  assert.ok((await say("what about prod?")).text.startsWith("sample-app (prod) is"));
});

test("two tabs keep separate conversations", async () => {
  const { say } = await setup();
  await say("is staging healthy?", "tab-1");

  const otherTab = await say("is it healthy?", "tab-2");

  assert.equal(otherTab.text, "Which environment: staging or prod?");
});

test("an app that is not deployed is reported with how to deploy it", async () => {
  const { say } = await setup();

  assert.equal(
    (await say("is prod healthy?")).text,
    "sample-app is not deployed in prod yet. To deploy it, type: deploy sample-app version v1 to prod",
  );
});

test("full status, nodes and the busiest pod are answered", async () => {
  const { say } = await setup();

  assert.ok((await say("full status of staging")).text.includes("Image: sample-app:v1 | CPU: 14% of limits"));
  assert.equal((await say("how are the nodes doing?")).text, "1 node, all Ready\nnode-1: CPU 41%, memory 63% | Ready");
  assert.match((await say("which pod is using the most memory in staging?")).text, /^sample-app-v1-\d+: 127Mi \(50% of limit\)$/);
});

test("without metrics-server a usage question is answered with the reason and no numbers", async () => {
  const { say, gateway } = await setup();
  gateway.metricsError = new MetricsUnavailableError("metrics-server is not installed in this cluster, so CPU and memory usage is not available.");

  const reply = await say("how much cpu and ram is staging using?");

  assert.equal(reply.text, "metrics-server is not installed in this cluster, so CPU and memory usage is not available.");
});

test("an unreachable cluster is reported as a normal reply", async () => {
  const { say, gateway } = await setup();
  gateway.failNext("getDeployment", new ClusterUnreachableError('I can\'t reach the cluster (context "fake-cluster").'));

  assert.equal((await say("is staging healthy?")).text, 'I can\'t reach the cluster (context "fake-cluster").');
});

test("a message the agent does not understand gets one sentence that lists what it can do", async () => {
  const { say } = await setup();

  const reply = await say("tell me a joke");

  assert.equal(
    reply.text,
    "I'm not sure how to help with that. I can deploy, roll back and scale your apps, and show their health, CPU and memory, a full status, the nodes and past deployments.",
  );
});

test("a message the agent does not understand comes with a few requests to try instead", async () => {
  const { say } = await setup();

  const reply = await say("tell me a joke");

  assert.deepEqual(reply.suggestions, [
    "is staging healthy?",
    "deploy sample-app version v2 to staging",
    "show my last 5 deployments",
    "what can you do?",
  ]);
});

test("the requests to try are kept with the conversation, so a page reload still shows them", async () => {
  const { say, sessions } = await setup();

  const reply = await say("tell me a joke");

  assert.deepEqual(sessions.get(TAB).messages.at(-1)?.suggestions, reply.suggestions);
  assert.equal(reply.suggestions?.length, 4);
});

// ---- History ----

test('"my" deployments are only those of the person asking', async () => {
  const { say, agent, operations } = await setup();
  const first = await say(DEPLOY_V2, TAB, "asha");
  await finished(operations, (await agent.confirm(TAB, first.action?.id ?? "", "asha")).operationId);
  const second = await say("scale staging to 5 replicas", "tab-2", "ravi");
  await finished(operations, (await agent.confirm("tab-2", second.action?.id ?? "", "ravi")).operationId);

  const mine = await say("show my last 5 deployments", TAB, "asha");
  const all = await say("list deployments", TAB, "asha");

  assert.equal(mine.text.split("\n")[0], "Last 1 deployment by asha:");
  assert.ok(mine.text.includes("dep-001 | staging | deploy sample-app:v1 -> sample-app:v2 | succeeded | asha"), mine.text);
  assert.equal(all.text.split("\n")[0], "Last 2 deployments:");
});

// ---- The conversation is kept per tab ----

test("each message and reply is recorded in the tab's session", async () => {
  const { say, sessions } = await setup();
  const reply = await say(DEPLOY_V2);

  const messages = sessions.get(TAB).messages;

  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.role, "user");
  assert.equal(messages[0]?.text, DEPLOY_V2);
  assert.equal(messages[1]?.role, "agent");
  assert.equal(messages[1]?.action?.id, reply.action?.id);
  assert.equal(sessions.get("tab-2").messages.length, 0);
});

// ---- Messages read by OpenAI instead of the rules ----

/** Stands in for the OpenAI reader: gives the listed readings in order and records what it was asked. */
function scriptedReader(readings: Reading[]) {
  const asked: { text: string; awaiting: ParsedMessage | undefined }[] = [];
  const reader: MessageReader = {
    description: "Messages are read by a test reader.",
    read: async (text, awaiting) => {
      asked.push({ text, awaiting });
      return readings.shift() ?? { parsed: { intent: null } };
    },
  };
  return { reader, asked };
}

const FALLBACK_NOTE = "OpenAI rejected the API key. I read this message with my built-in rules instead.";

test("a message read by the model gets the same summary and still changes nothing without Confirm", async () => {
  const { reader } = scriptedReader([{ parsed: { intent: "deploy", version: "v2", environment: "staging" } }]);
  const { say, gateway } = await setup(reader);

  const reply = await say("push v2 out to staging");

  assert.equal(
    reply.text,
    'I\'ll update deployment "sample-app" in namespace "staging" to image sample-app:v2 (3 replicas). It runs sample-app:v1 now.',
  );
  assert.ok(reply.action, "the reply should offer Confirm and Cancel");
  assert.deepEqual(gateway.writes, []);
});

test("a value the model got wrong is refused by the same checks as a typed one", async () => {
  const { reader } = scriptedReader([{ parsed: { intent: "scale", environment: "staging", replicas: 500 } }]);
  const { say, gateway } = await setup(reader);

  const reply = await say("make staging huge");

  assert.equal(reply.text, "sample-app can have at most 10 replicas (maxReplicas in the config file). You asked for 500.");
  assert.equal(reply.action, undefined);
  assert.deepEqual(gateway.writes, []);
});

test("a change read by the model never borrows the environment from earlier messages either", async () => {
  const { reader } = scriptedReader([
    { parsed: { intent: "health", environment: "prod" } },
    { parsed: { intent: "rollback" } },
  ]);
  const { say } = await setup(reader);
  await say("how is prod doing?");

  const reply = await say("undo that last release");

  assert.equal(reply.text, "Roll back sample-app in which environment: staging or prod?");
  assert.equal(reply.action, undefined);
});

test("the reader is given the open question, and its answer completes the request", async () => {
  const { reader, asked } = scriptedReader([
    { parsed: { intent: "deploy", version: "v2" } },
    { parsed: { intent: null, environment: "staging" } },
  ]);
  const { say } = await setup(reader);

  const question = await say("ship v2");
  const summary = await say("the staging one please");

  assert.equal(question.text, "Deploy sample-app version v2 to which environment: staging or prod?");
  assert.equal(asked[0].awaiting, undefined);
  assert.deepEqual(asked[1].awaiting, { intent: "deploy", version: "v2", app: "sample-app" });
  assert.ok(summary.action);
  assert.ok(summary.text.includes("to image sample-app:v2"), summary.text);
});

test("a follow-up that names an environment that does not exist is not answered for the old one", async () => {
  const { reader } = scriptedReader([
    { parsed: { intent: "health", environment: "staging" } },
    { parsed: { intent: null, unknownEnvironment: "qa" } },
  ]);
  const { say } = await setup(reader);
  await say("is staging healthy?");

  const reply = await say("and what about qa?");

  assert.equal(reply.text, 'There is no environment called "qa". I know: staging, prod. Which one do you mean?');
});

test("every reply to a message the rules read for OpenAI says so; other replies do not", async () => {
  const failed: Reading = { parsed: { intent: "nodes" }, fallbackNote: FALLBACK_NOTE };
  const { reader } = scriptedReader([failed, failed, { parsed: { intent: "nodes" } }]);
  const { say } = await setup(reader);
  const nodes = "1 node, all Ready\nnode-1: CPU 41%, memory 63% | Ready";

  assert.equal((await say("how are the nodes?")).text, `${nodes}\nNote: ${FALLBACK_NOTE}`);
  assert.equal((await say("how are the nodes?")).text, `${nodes}\nNote: ${FALLBACK_NOTE}`);
  assert.equal((await say("how are the nodes?")).text, nodes, "OpenAI read this one: nothing to add");
});

test("the note is added to a refusal too, and is kept in the conversation", async () => {
  const { reader } = scriptedReader([
    { parsed: { intent: "deploy", version: "latest", environment: "staging" }, fallbackNote: FALLBACK_NOTE },
  ]);
  const { say, sessions } = await setup(reader);

  const reply = await say("deploy latest to staging");

  assert.ok(reply.text.startsWith('I don\'t deploy the "latest" tag'), reply.text);
  assert.ok(reply.text.endsWith(`\nNote: ${FALLBACK_NOTE}`), reply.text);
  assert.equal(sessions.get(TAB).messages.at(-1)?.text, reply.text);
});

test("help says how messages are read: by the rules when no LLM is configured", async () => {
  const { say } = await setup();

  const reply = await say("help");

  assert.ok(
    reply.text.endsWith("\nMessages are read by built-in rules. The LLM is not configured (OPENAI_API_KEY is not set)."),
    reply.text,
  );
});

test("help names the reader that is in use", async () => {
  const { reader } = scriptedReader([{ parsed: { intent: "help" } }]);
  const { say } = await setup(reader);

  assert.ok((await say("what can you do")).text.endsWith("\nMessages are read by a test reader."));
});

test("the did-not-understand reply does not name the reader: that is for help and the terminal", async () => {
  const { reader } = scriptedReader([{ parsed: { intent: null } }]);
  const { say } = await setup(reader);

  const reply = await say("tell me a joke");

  assert.ok(!reply.text.includes("Messages are read by"), reply.text);
});
