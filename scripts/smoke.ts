// Developer tool: talks to a real cluster through the gateway, without the web app.
// Useful for checking that the Kubernetes calls work before trusting the chat.
//
//   node scripts/smoke.ts read [namespace] [app]

import { KubeGateway } from "../src/cluster/kubeGateway.ts";
import { AppError, MetricsUnavailableError } from "../src/errors.ts";

const gateway = new KubeGateway(process.env.KUBE_CONTEXT);

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
  const [command, namespace = "staging", app = "sample-app"] = process.argv.slice(2);
  if (command === "read") {
    await read(namespace, app);
    return;
  }
  console.log("Usage: node scripts/smoke.ts read [namespace] [app]");
  process.exitCode = 1;
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
