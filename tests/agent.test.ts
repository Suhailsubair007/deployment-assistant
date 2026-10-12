import assert from "node:assert/strict";
import { test } from "node:test";

import { Agent } from "../src/agent/agent.ts";
import { SessionStore } from "../src/agent/sessionStore.ts";
import { loadConfig } from "../src/config.ts";
import { ClusterUnreachableError, MetricsUnavailableError } from "../src/errors.ts";
import { DeploymentService } from "../src/services/deploymentService.ts";
import { FailureExplainer } from "../src/services/failureExplainer.ts";
import { HistoryStore } from "../src/services/historyStore.ts";
import { MetricsService } from "../src/services/metricsService.ts";
import { OperationStore } from "../src/services/operationStore.ts";
import { StatusService } from "../src/services/statusService.ts";
import { FakeGateway } from "./helpers/fakeGateway.ts";

const TAB = "tab-1";
const DEPLOY_V2 = "deploy sample-app version v2 to staging";

/**
 * The real agent and services on top of a pretend cluster.
 * sample-app v1 runs in staging with 3 pods; prod is empty.
 */
async function setup() {
  const gateway = new FakeGateway();
  gateway.seed("staging", "sample-app", "sample-app:v1", 3);
  for (const pod of await gateway.listPods("staging", "sample-app")) {
    gateway.podUsage.set(pod.name, { cpu: "70m", memory: "127Mi" });
  }
  const config = loadConfig("config/app.config.yaml");
  const history = new HistoryStore(":memory:");
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

test("a message the agent does not understand gets the list of things it can do", async () => {
  const { say } = await setup();

  const reply = await say("tell me a joke");

  assert.ok(reply.text.startsWith("I didn't understand that."), reply.text);
  assert.ok(reply.text.includes("deploy sample-app version v2 to staging"), reply.text);
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
