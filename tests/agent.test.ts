import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Agent } from "@/agent/agent.ts";
import type { ParsedMessage, RecentMessage } from "@/types/agent.ts";
import type { MessageReader, Reading } from "@/types/agent.ts";
import { createRuleReader } from "@/agent/messageReader.ts";
import { SessionStore } from "@/agent/sessionStore.ts";
import { WIZARD_BUSY } from "@/constants/agent.ts";
import { loadConfig } from "@/config.ts";
import { ClusterUnreachableError, MetricsUnavailableError } from "@/errors.ts";
import { DeploymentService } from "@/services/deploymentService.ts";
import { FailureExplainer } from "@/services/failureExplainer.ts";
import { HistoryStore } from "@/services/historyStore.ts";
import { MetricsService } from "@/services/metricsService.ts";
import { OperationStore } from "@/services/operationStore.ts";
import { ServiceRegistry } from "@/services/serviceRegistry.ts";
import type { ServiceSpec } from "@/types/service.ts";
import { StatusService } from "@/services/statusService.ts";
import { createServiceFlow } from "@/agent/serviceFlow.ts";
import type { BuildTools } from "@/types/build.ts";
import type { ServiceFlow, WizardContext } from "@/types/wizard.ts";
import { FakeBuildTools } from "./helpers/fakeBuildTools.ts";
import { FakeGateway } from "./helpers/fakeGateway.ts";

const TAB = "tab-1";
const DEPLOY_V2 = "deploy sample-app version v2 to staging";

// A project folder with a Dockerfile, inside a folder the assistant is allowed to build from.
const PROJECTS = realpathSync(mkdtempSync(join(tmpdir(), "projects-")));
const FOLDER = join(PROJECTS, "orders-api");
mkdirSync(FOLDER);
writeFileSync(join(FOLDER, "Dockerfile"), "FROM node:24-alpine\nEXPOSE 3000\n");

/**
 * The real agent and services on top of a pretend cluster.
 * sample-app v1 runs in staging with 3 pods; prod is empty.
 *
 * @param reader how messages are read; left out, the agent uses the built-in rules
 * @param build what builds images; left out, a pretend builder that behaves like a kind cluster. Null: nothing can be built.
 */
async function setup(reader?: MessageReader, build: BuildTools | null = new FakeBuildTools(), questions?: ServiceFlow) {
  const gateway = new FakeGateway();
  gateway.seed("staging", "sample-app", "sample-app:v1", 3);
  for (const pod of await gateway.listPods("staging", "sample-app")) {
    gateway.podUsage.set(pod.name, { cpu: "70m", memory: "127Mi" });
  }
  const config = loadConfig("config/app.config.yaml");
  config.build.allowedRoots = [PROJECTS];
  const history = new HistoryStore(":memory:", "fake-cluster");
  const operations = new OperationStore();
  const explainer = new FailureExplainer(gateway);
  const sessions = new SessionStore();
  const registry = new ServiceRegistry({ path: ":memory:", cluster: "fake-cluster", config });
  let nowMs = Date.parse("2026-10-12T12:00:00Z");
  const agent = new Agent({
    config,
    history,
    sessions,
    registry,
    deployments: new DeploymentService({
      gateway,
      history,
      operations,
      config,
      registry,
      explainer,
      build: build ?? undefined,
      sleep: async () => {},
    }),
    statuses: new StatusService({ gateway, history, config, registry, explainer, metrics: new MetricsService(gateway) }),
    now: () => nowMs,
    reader,
    questions,
  });
  return {
    agent,
    gateway,
    history,
    operations,
    sessions,
    registry,
    build,
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
    "I didn't quite catch that. Here is what I can help with: pick one, or say it in other words.",
  );
});

test("a message the agent does not understand asks the browser to show what it can do", async () => {
  const { say } = await setup();

  const reply = await say("tell me a joke");

  assert.equal(reply.showCapabilities, true);
});

test("the request to show what it can do is kept with the conversation, so a page reload still shows it", async () => {
  const { say, sessions } = await setup();

  await say("tell me a joke");

  assert.equal(sessions.get(TAB).messages.at(-1)?.showCapabilities, true);
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
  const recents: RecentMessage[][] = [];
  const reader: MessageReader = {
    description: "Messages are read by a test reader.",
    read: async (text, awaiting, recent = []) => {
      asked.push({ text, awaiting });
      recents.push(recent);
      return readings.shift() ?? { parsed: { intent: null } };
    },
  };
  return { reader, asked, recents };
}

test("a chat answer from the model is the reply, and changes nothing", async () => {
  const answer = "A replica is one running copy of your app. More copies means more visitors can be served at once.";
  const { reader } = scriptedReader([{ parsed: { intent: "chat", reply: answer } }]);
  const { say, gateway } = await setup(reader);

  const reply = await say("what is a replica?");

  assert.equal(reply.text, answer);
  assert.equal(reply.action, undefined);
  assert.deepEqual(gateway.writes, []);
});

test("a chat answer leaves an open question open, so the next message still answers it", async () => {
  const { reader, asked } = scriptedReader([
    { parsed: { intent: "scale", app: "sample-app", environment: "staging" } },
    { parsed: { intent: "chat", reply: "A replica is one running copy of your app." } },
    { parsed: { intent: null, replicas: 4 } },
  ]);
  const { say } = await setup(reader);

  await say("scale sample-app in staging");
  await say("what is a replica?");
  const reply = await say("4 then");

  assert.deepEqual(asked[2].awaiting, { intent: "scale", app: "sample-app", environment: "staging" });
  assert.ok(reply.action, "the reply should offer Confirm and Cancel");
});

test("the reader sees the conversation before the message", async () => {
  const { reader, recents } = scriptedReader([
    { parsed: { intent: "health", app: "sample-app", environment: "staging" } },
    { parsed: { intent: "chat", reply: "It means all copies are running." } },
  ]);
  const { say } = await setup(reader);

  const health = await say("is sample-app healthy in staging?");
  await say("what does that mean?");

  assert.deepEqual(recents[0], []);
  assert.deepEqual(recents[1], [
    { role: "user", text: "is sample-app healthy in staging?" },
    { role: "agent", text: health.text },
  ]);
});

test("the answers to the service questions are never in the conversation the reader sees", async () => {
  const rules = createRuleReader({ environments: ["staging", "prod"], apps: ["sample-app"] });
  const recents: RecentMessage[][] = [];
  const watching: MessageReader = {
    description: rules.description,
    read: async (text, awaiting, recent = []) => {
      recents.push(recent);
      return rules.read(text, awaiting);
    },
  };
  const { say } = await setup(watching);
  await say("create a service");
  await say(FOLDER);
  await say("cancel");

  await say("show nodes");

  const seen = recents.at(-1)?.map((message) => message.text).join("\n") ?? "";
  assert.ok(!seen.includes(FOLDER), seen);
  assert.ok(seen.includes("create a service"), seen);
});

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

  assert.equal(reply.text, "sample-app can have at most 10 replicas. You asked for 500.");
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

// ---- More than one service ----

const ORDERS_API: ServiceSpec = {
  name: "orders-api",
  environment: "staging",
  imageRepository: "orders-api",
  folder: null,
  port: 3000,
  healthPath: "/health",
  replicas: 2,
  maxReplicas: 4,
  resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "256Mi" } },
  env: [],
  lastVersion: 0,
};

test("a service saved while the app runs is known by name at once", async () => {
  const { say, registry } = await setup();

  registry.save(ORDERS_API);
  const reply = await say("is orders-api healthy in staging?");

  assert.match(reply.text, /^orders-api is not deployed in staging yet\./);
});

test("with two services, a question that names none asks which one", async () => {
  const { say, registry } = await setup();
  registry.save(ORDERS_API);

  const question = await say("is it healthy in staging?");
  const answer = await say("sample-app");

  assert.equal(question.text, "Which app: sample-app or orders-api?");
  assert.match(answer.text, /^sample-app \(staging\) is HEALTHY/);
});

test("with two services, help, nodes and history are answered without asking which app", async () => {
  const { say, registry } = await setup();
  registry.save(ORDERS_API);

  const help = await say("help");
  const nodes = await say("how are the nodes doing?");
  const history = await say("show my last 5 deployments");

  for (const reply of [help, nodes, history]) {
    assert.doesNotMatch(reply.text, /Which app/);
  }
  assert.match(nodes.text, /node-1/);
});

// ---- Creating a service from the chat, one question at a time ----

type Say = (text: string) => Promise<{ text: string; action?: { id: string; warning: string | null } }>;

/** Asks for a new service and answers every question. The reply it returns is the summary to confirm. */
async function createOrdersApi(say: Say, answers: { environment?: string; variables?: string } = {}) {
  await say("create a service");
  await say(FOLDER);
  await say("default"); // the name: orders-api, from the folder
  await say(answers.environment ?? "staging");
  await say("default"); // the port: 3000, from the Dockerfile
  await say("default"); // the health path
  await say("default"); // CPU
  await say("default"); // memory
  await say("default"); // replicas
  await say("default"); // the most replicas
  return say(answers.variables ?? "NODE_ENV=production");
}

test('"create a service" starts the questions with the project folder', async () => {
  const { say } = await setup();

  const reply = await say("create a service");

  assert.match(reply.text, /^I'll ask one thing at a time\./);
  assert.match(reply.text, /Where is the project folder\?/);
  assert.equal(reply.action, undefined);
});

test("each answer gets the next question, with the value that default would take", async () => {
  const { say } = await setup();
  await say("create a service");

  const name = await say(FOLDER);
  const environment = await say("default");
  const port = await say("staging");

  assert.equal(name.text, "What should the service be called?\nDefault: orders-api");
  assert.equal(environment.text, "Which environment: staging or prod?");
  assert.equal(port.text, "Which port does the app listen on?\nDefault: 3000 (from the Dockerfile)");
});

test("the last answer gets the summary to confirm, and nothing has been built or changed", async () => {
  const { say, gateway, build, registry } = await setup();

  const reply = await createOrdersApi(say);

  assert.match(reply.text, /^Create orders-api in staging\?\n/);
  for (const row of [`Folder | ${FOLDER}`, "Image | orders-api:v1", "Port | 3000", "Health check | /health", "Variables | NODE_ENV=production"]) {
    assert.ok(reply.text.includes(row), `the summary should have the row: ${row}\n${reply.text}`);
  }
  assert.equal(reply.action?.warning, null);
  assert.deepEqual(gateway.writes, []);
  assert.deepEqual((build as FakeBuildTools).calls, []);
  assert.equal(registry.find("staging", "orders-api"), null);
});

test("Confirm builds the image, hands it to the cluster and starts the service", async () => {
  const { agent, say, gateway, operations, build, registry } = await setup();
  const summary = await createOrdersApi(say);

  const reply = await agent.confirm(TAB, summary.action?.id ?? "", "asha");
  const operation = await finished(operations, reply.operationId);

  assert.equal(reply.text, "Build started (dep-001).");
  assert.equal(operation.state, "succeeded");
  assert.deepEqual((build as FakeBuildTools).calls, [`build ${FOLDER} orders-api:v1`, "publish orders-api:v1"]);
  assert.deepEqual(gateway.writes, ["applyService staging orders-api", "applyDeployment staging orders-api:v1 x2"]);
  assert.equal(registry.find("staging", "orders-api")?.folder, FOLDER);
});

test("the answers are checked by fixed rules and never handed to the message reader", async () => {
  const rules = createRuleReader({ environments: ["staging", "prod"], apps: ["sample-app"] });
  const read: string[] = [];
  const counting: MessageReader = {
    description: rules.description,
    read: async (text, awaiting) => {
      read.push(text);
      return rules.read(text, awaiting);
    },
  };
  const { say } = await setup(counting);

  await createOrdersApi(say);

  assert.deepEqual(read, ["create a service"]);
});

test("another request typed in the middle of the questions is not carried out", async () => {
  const { say, gateway } = await setup();
  await say("create a service");
  await say(FOLDER);

  const reply = await say(DEPLOY_V2);
  const next = await say("default");

  assert.equal(reply.text, `${WIZARD_BUSY.create}\nWhat should the service be called?\nDefault: orders-api`);
  assert.equal(reply.action, undefined);
  assert.deepEqual(gateway.writes, []);
  // The questions go on from where they were.
  assert.equal(next.text, "Which environment: staging or prod?");
});

test("a bad answer gets the reason and the same question again", async () => {
  const { say } = await setup();
  await say("create a service");

  const reply = await say("/nowhere/at/all");

  assert.match(reply.text, /^I can't find a folder at \/nowhere\/at\/all\.\nWhere is the project folder\?/);
});

test("cancel stops the questions, and the chat answers other requests again", async () => {
  const { say } = await setup();
  await say("create a service");
  await say(FOLDER);

  const cancelled = await say("cancel");
  const health = await say("is sample-app healthy in staging?");

  assert.equal(cancelled.text, "Cancelled. Nothing was created.");
  assert.match(health.text, /^sample-app \(staging\) is HEALTHY/);
});

test("a service created in prod carries the extra warning", async () => {
  const { say } = await setup();

  const reply = await createOrdersApi(say, { environment: "prod" });

  assert.match(reply.text, /^Create orders-api in prod\?/);
  assert.match(reply.action?.warning ?? "", /prod is a protected environment/);
});

test("a create request that already names the environment does not ask for it again", async () => {
  const { reader } = scriptedReader([{ parsed: { intent: "create", environment: "prod" } }]);
  const { say } = await setup(reader);
  await say("set up a new service on prod for me");
  await say(FOLDER);

  const afterName = await say("default");

  assert.match(afterName.text, /^Which port does the app listen on\?/);
});

test("on a cluster the assistant cannot build for, the questions do not start", async () => {
  const { say } = await setup(undefined, null);

  const reply = await say("create a service");

  assert.equal(reply.text, "I can build images only for a kind cluster or an EKS cluster, and this cluster is neither.");
});

// ---- Changing and rebuilding a service made in the chat ----

/** orders-api v1, built from the folder, runs in staging with 2 pods. */
async function setupWithOrdersApi() {
  const all = await setup();
  all.registry.save({
    ...ORDERS_API,
    folder: FOLDER,
    resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "256Mi" } },
    lastVersion: 1,
  });
  all.gateway.seed("staging", "orders-api", "orders-api:v1", 2);
  return all;
}

test("edit lists the settings, asks for the one to change, and offers the change for confirmation", async () => {
  const { say, gateway } = await setupWithOrdersApi();

  const list = await say("edit orders-api in staging");
  const question = await say("memory");
  const summary = await say("128Mi to 512Mi");

  assert.match(list.text, /^What do you want to change in orders-api \(staging\)\?\n/);
  assert.ok(list.text.includes("memory | 128Mi to 256Mi"), list.text);
  assert.ok(question.text.includes("Now: 128Mi to 256Mi"), question.text);
  assert.equal(
    summary.text,
    [
      "Change the settings of orders-api in staging?",
      "Memory | 128Mi to 256Mi -> 128Mi to 512Mi",
      "Note: The pods are replaced one at a time with the new settings. The image stays orders-api:v1.",
    ].join("\n"),
  );
  assert.ok(summary.action);
  assert.deepEqual(gateway.writes, []);
});

test("a confirmed settings change is applied with the same image and stored", async () => {
  const { agent, say, gateway, operations, registry } = await setupWithOrdersApi();
  await say("edit orders-api in staging");
  await say("variables");
  const summary = await say("LOG_LEVEL=debug");

  const reply = await agent.confirm(TAB, summary.action?.id ?? "", "asha");
  const operation = await finished(operations, reply.operationId);

  assert.equal(reply.text, "Applying the new settings (dep-001).");
  assert.equal(operation.state, "succeeded");
  assert.deepEqual(gateway.writes, ["applyService staging orders-api", "applyDeployment staging orders-api:v1 x2"]);
  assert.deepEqual(registry.find("staging", "orders-api")?.env, [{ name: "LOG_LEVEL", value: "debug" }]);
});

test("edit without an environment asks which one first", async () => {
  const { say } = await setupWithOrdersApi();

  const question = await say("edit orders-api");
  const list = await say("staging");

  assert.equal(question.text, "Change the settings of orders-api in which environment: staging or prod?");
  assert.match(list.text, /^What do you want to change in orders-api \(staging\)\?/);
});

test("deploying a service that is built from a folder needs no version: it offers to build the next one", async () => {
  const { say, gateway } = await setupWithOrdersApi();

  const reply = await say("deploy orders-api to staging");

  assert.equal(
    reply.text,
    `Build orders-api from ${FOLDER} and deploy it to staging as orders-api:v2 (2 replicas)? It runs orders-api:v1 now.`,
  );
  assert.ok(reply.action);
  assert.deepEqual(gateway.writes, []);
});

test("a named version of a folder service is deployed as it is, without building", async () => {
  const { say } = await setupWithOrdersApi();

  const reply = await say("deploy orders-api version v3 to staging");

  assert.match(reply.text, /^I'll update deployment "orders-api" in namespace "staging" to image orders-api:v3/);
});

test("a request that happens to name an environment is not taken as the answer to which environment", async () => {
  const { say, gateway } = await setup();
  await say("create a service");
  await say(FOLDER);
  await say("default"); // the name; the next question is the environment

  const reply = await say(DEPLOY_V2);

  assert.equal(reply.text, `${WIZARD_BUSY.create}\nWhich environment: staging or prod?`);
  assert.deepEqual(gateway.writes, []);
});

// ---- The questions run as a LangGraph workflow ----

test("every question and answer goes through the question flow, one conversation per tab", async () => {
  // The real flow, wrapped so the test can see what the agent hands to it.
  let context: WizardContext | undefined;
  const real = createServiceFlow({
    context: () => {
      assert.ok(context, "the test sets the context before the first answer");
      return context;
    },
  });
  const calls: string[] = [];
  const recording: ServiceFlow = {
    start: (thread, first) => {
      calls.push(`start ${thread}`);
      // The first step carries no context; the answers are checked with the folder rule below.
      return real.start(thread, first);
    },
    answer: (thread, text) => {
      calls.push(`answer ${thread} ${text}`);
      return real.answer(thread, text);
    },
  };
  const { say } = await setup(undefined, undefined, recording);
  context = {
    environments: ["staging", "prod"],
    defaults: loadConfig("config/app.config.yaml").serviceDefaults,
    exists: () => false,
    inspect: () => ({ folder: FOLDER, port: 3000, suggestedName: "orders-api" }),
  };

  await say("create a service", "tab-a");
  await say("create a service", "tab-b");
  const name = await say(FOLDER, "tab-a");
  await say("cancel", "tab-b");

  const [threadA, threadB] = [calls[0].split(" ")[1], calls[1].split(" ")[1]];
  assert.notEqual(threadA, threadB);
  assert.deepEqual(calls, [`start ${threadA}`, `start ${threadB}`, `answer ${threadA} ${FOLDER}`, `answer ${threadB} cancel`]);
  assert.equal(name.text, "What should the service be called?\nDefault: orders-api");
});

test("when the flow has lost a conversation, the chat says so and answers normally again", async () => {
  const gone: ServiceFlow = {
    start: async (_thread, first) => first,
    answer: async () => ({ kind: "cancelled", text: 'I lost track of these questions. Type "create a service" to start again.' }),
  };
  const { say } = await setup(undefined, undefined, gone);
  await say("create a service");

  const lost = await say(FOLDER);
  const health = await say("is sample-app healthy in staging?");

  assert.equal(lost.text, 'I lost track of these questions. Type "create a service" to start again.');
  assert.match(health.text, /^sample-app \(staging\) is HEALTHY/);
});

test("a single wrong word is treated as a bad answer, not as another request", async () => {
  const { say } = await setup();
  await say("create a service");
  await say(FOLDER);
  await say("default"); // the name
  await say("staging");
  await say("default"); // the port; the next question is the health path

  const reply = await say("health");

  assert.match(reply.text, /^The path must start with \//);
  assert.doesNotMatch(reply.text, /in the middle of creating a service/);
});
