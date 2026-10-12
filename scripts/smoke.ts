// Developer tool: talks to a real cluster through the gateway, without the web app.
// Useful for checking that the Kubernetes calls work before trusting the chat.
//
//   node scripts/smoke.ts read [environment]
//   node scripts/smoke.ts deploy <version> [environment]
//   node scripts/smoke.ts scale <replicas> [environment]
//   node scripts/smoke.ts rollback [environment]
//   node scripts/smoke.ts status [environment]
//   node scripts/smoke.ts wait-status <HEALTHY|DEGRADED|DOWN> [environment]   (checks every 5 s, up to 3 minutes)

import { KubeGateway } from "../src/cluster/kubeGateway.ts";
import { loadConfig } from "../src/config.ts";
import { AppError, MetricsUnavailableError } from "../src/errors.ts";
import { DeploymentService } from "../src/services/deploymentService.ts";
import type { ChangePlan } from "../src/services/deploymentService.ts";
import { FailureExplainer } from "../src/services/failureExplainer.ts";
import { HistoryStore } from "../src/services/historyStore.ts";
import { MetricsService } from "../src/services/metricsService.ts";
import { OperationStore } from "../src/services/operationStore.ts";
import { StatusService } from "../src/services/statusService.ts";
import { formatCpu, formatMemory } from "../src/services/units.ts";

const APP = "sample-app";

const gateway = new KubeGateway(process.env.KUBE_CONTEXT);
const config = loadConfig(process.env.CONFIG_PATH ?? "config/app.config.yaml");
const history = new HistoryStore(process.env.DB_PATH ?? "data/assistant.db");
const explainer = new FailureExplainer(gateway);
const deployments = new DeploymentService({
  gateway,
  history,
  operations: new OperationStore(),
  config,
  explainer,
  imageRegistry: process.env.IMAGE_REGISTRY,
});
const statuses = new StatusService({ gateway, history, config, explainer, metrics: new MetricsService(gateway) });

/** Prints the verdict for one environment and returns it. */
async function printStatus(environment: string): Promise<string> {
  const status = await statuses.getStatus(environment, APP);
  if (status === null) {
    console.log(`${APP} is not deployed in ${environment}.`);
    return "NOT DEPLOYED";
  }
  const { deployment, probe, usage, health } = status;
  console.log(`${APP} (${environment}) is ${health.status}`);
  console.log(
    `  pods ${deployment.availableReplicas}/${deployment.desiredReplicas} available | ` +
      `/health: ${probe.statusCode ?? "no answer"} in ${probe.responseMs} ms | image ${deployment.image}`,
  );
  if (usage.available) {
    for (const pod of usage.pods) {
      console.log(
        `  ${pod.podName}: CPU ${formatCpu(pod.cpu.used)} (${pod.cpu.percentOfLimit}% of limit), ` +
          `memory ${formatMemory(pod.memory.used)} (${pod.memory.percentOfLimit}% of limit)`,
      );
    }
  }
  for (const reason of health.reasons) {
    console.log(`  reason: ${reason}`);
  }
  for (const note of health.notes) {
    console.log(`  note: ${note}`);
  }
  return health.status;
}

/** Checks the status every 5 seconds until it is the wanted one, for at most 3 minutes. */
async function waitForStatus(wanted: string, environment: string): Promise<void> {
  for (let attempt = 0; attempt < 36; attempt++) {
    const status = await statuses.getStatus(environment, APP);
    if (status?.health.status === wanted) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  await printStatus(environment);
}

/** Carries out a plan and prints each progress step as it appears. */
async function carryOut(plan: ChangePlan): Promise<void> {
  console.log(
    `${plan.action}: ${plan.app} in ${plan.environment}: ` +
      `${plan.currentImage ?? "(not deployed)"} x${plan.currentReplicas ?? 0} -> ${plan.image} x${plan.replicas}`,
  );
  const { operation, done } = await deployments.execute(plan, "smoke-test");
  let printed = 0;
  const printNewSteps = (): void => {
    for (; printed < operation.steps.length; printed++) {
      console.log(`  ${operation.steps[printed]}`);
    }
  };
  const timer = setInterval(printNewSteps, 500);
  await done;
  clearInterval(timer);
  printNewSteps();
  console.log(`${operation.state}: ${operation.message}`);
}

async function read(namespace: string, app: string): Promise<void> {
  console.log(`Context: ${gateway.contextName()}`);
  console.log(`Namespace ${namespace} exists: ${await gateway.namespaceExists(namespace)}`);

  console.log("\nNodes:");
  for (const node of await gateway.listNodes()) {
    console.log(" ", JSON.stringify(node));
  }

  console.log(`\nDeployment ${app}:`);
  console.log(" ", JSON.stringify(await gateway.getDeployment(namespace, app)));

  console.log("\nPods:");
  for (const pod of await gateway.listPods(namespace, app)) {
    console.log(" ", JSON.stringify(pod));
  }

  console.log("\nGET /health through the Service:");
  console.log(" ", JSON.stringify(await gateway.getServiceHealth(namespace, app, 80, 3000)));

  console.log("\nUsage:");
  try {
    for (const usage of await gateway.listNodeMetrics()) {
      console.log("  node", JSON.stringify(usage));
    }
    for (const usage of await gateway.listPodMetrics(namespace)) {
      console.log("  pod ", JSON.stringify(usage));
    }
  } catch (error) {
    if (!(error instanceof MetricsUnavailableError)) {
      throw error;
    }
    console.log(" ", error.message);
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "read":
      await read(rest[0] ?? "staging", APP);
      return;
    case "deploy":
      await carryOut(await deployments.planDeploy({ environment: rest[1] ?? "staging", app: APP, version: rest[0] ?? "" }));
      return;
    case "scale":
      await carryOut(await deployments.planScale({ environment: rest[1] ?? "staging", app: APP, replicas: Number(rest[0]) }));
      return;
    case "rollback":
      await carryOut(await deployments.planRollback({ environment: rest[0] ?? "staging", app: APP }));
      return;
    case "status":
      await printStatus(rest[0] ?? "staging");
      return;
    case "wait-status":
      await waitForStatus(rest[0] ?? "HEALTHY", rest[1] ?? "staging");
      return;
    default:
      console.log("Usage: node scripts/smoke.ts read|status|deploy <version>|scale <replicas>|rollback [environment]");
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  // Errors meant for people are printed as one line. Anything else is a bug: show it in full.
  if (error instanceof AppError) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  throw error;
});
