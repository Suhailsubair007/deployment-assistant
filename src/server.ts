import { existsSync } from "node:fs";
import { join } from "node:path";

import { Agent } from "@/agent/agent.ts";
import { createMessageReader } from "@/agent/messageReader.ts";
import { SessionStore } from "@/agent/sessionStore.ts";
import { createApp } from "@/api/routes.ts";
import { KubeGateway } from "@/cluster/kubeGateway.ts";
import { ConfigError, loadConfig } from "@/config.ts";
import { DEFAULT_CONFIG_PATH, DEFAULT_DB_PATH, DEFAULT_PORT, HOST, PAGE_FOLDER } from "@/constants/server.ts";
import { DeploymentService } from "@/services/deploymentService.ts";
import { FailureExplainer } from "@/services/failureExplainer.ts";
import { HistoryStore } from "@/services/historyStore.ts";
import { MetricsService } from "@/services/metricsService.ts";
import { OperationStore } from "@/services/operationStore.ts";
import { StatusService } from "@/services/statusService.ts";

const port = Number(process.env.PORT || DEFAULT_PORT);

function start(): void {
  const config = loadConfig(process.env.CONFIG_PATH || DEFAULT_CONFIG_PATH);

  const gateway = new KubeGateway(process.env.KUBE_CONTEXT || undefined);

  const history = new HistoryStore(process.env.DB_PATH || DEFAULT_DB_PATH);
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
  const reader = createMessageReader({
    known: { environments: Object.keys(config.environments), apps: Object.keys(config.apps) },
    apiKey: process.env.OPENAI_API_KEY,
    llm: config.llm,
  });
  const agent = new Agent({ config, deployments, statuses, history, sessions, reader });

  const app = createApp({
    agent,
    operations,
    statuses,
    sessions,
    staticFolder: PAGE_FOLDER,
  });

  app.listen(port, HOST, () => {
    console.log(`Deployment Assistant is running at http://${HOST}:${port}`);
    console.log(`Kubernetes context: ${gateway.contextName()}`);
    console.log(`Environments: ${Object.keys(config.environments).join(", ")}`);
    console.log(reader.description);
    if (!existsSync(join(PAGE_FOLDER, "index.html"))) {
      console.log('The page is not built yet. Run "npm run build", then reload the browser.');
    }
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
