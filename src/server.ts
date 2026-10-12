// Starts the Deployment Assistant. This file only wires the pieces together:
//
//   browser -> Web API -> Agent -> Services -> Cluster gateway -> Kubernetes
//
// Settings come from environment variables (see .env.example).

import { join } from "node:path";

import { Agent } from "./agent/agent.ts";
import { SessionStore } from "./agent/sessionStore.ts";
import { createApp } from "./api/routes.ts";
import { KubeGateway } from "./cluster/kubeGateway.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { DeploymentService } from "./services/deploymentService.ts";
import { FailureExplainer } from "./services/failureExplainer.ts";
import { HistoryStore } from "./services/historyStore.ts";
import { MetricsService } from "./services/metricsService.ts";
import { OperationStore } from "./services/operationStore.ts";
import { StatusService } from "./services/statusService.ts";

const HOST = "127.0.0.1"; // reachable from this machine only
const port = Number(process.env.PORT || 3000);

function start(): void {
  const config = loadConfig(process.env.CONFIG_PATH || "config/app.config.yaml");

  // The gateway never fails here. A wrong kubeconfig is reported in the chat instead,
  // so the app starts even when no cluster is running.
  const gateway = new KubeGateway(process.env.KUBE_CONTEXT || undefined);

  const history = new HistoryStore(process.env.DB_PATH || "data/assistant.db");
  const interrupted = history.recoverInterrupted();

  const operations = new OperationStore();
  const sessions = new SessionStore();
  const explainer = new FailureExplainer(gateway);
  const statuses = new StatusService({ gateway, history, config, explainer, metrics: new MetricsService(gateway) });
  const deployments = new DeploymentService({
    gateway,
    history,
    operations,
    config,
    explainer,
    imageRegistry: process.env.IMAGE_REGISTRY || undefined,
  });
  const agent = new Agent({ config, deployments, statuses, history, sessions });

  const app = createApp({
    agent,
    operations,
    statuses,
    sessions,
    staticFolder: join(import.meta.dirname, "../frontend"),
  });

  app.listen(port, HOST, () => {
    console.log(`Deployment Assistant is running at http://${HOST}:${port}`);
    console.log(`Kubernetes context: ${gateway.contextName()}`);
    console.log(`Environments: ${Object.keys(config.environments).join(", ")}`);
    console.log("Message parsing: rule-based. No LLM is used, so no API key is needed.");
    if (interrupted > 0) {
      console.log(`${interrupted} deployment(s) were left unfinished by the last run and are now marked "interrupted".`);
    }
  });
}

try {
  start();
} catch (error) {
  // A problem with the config file is the reader's to fix: show the sentence, not a stack trace.
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
