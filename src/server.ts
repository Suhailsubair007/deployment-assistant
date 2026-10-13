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
import { formatStartupBanner, formatStartupError } from "@/startupBanner.ts";

const port = Number(process.env.PORT || DEFAULT_PORT);

function start(): void {
  const config = loadConfig(process.env.CONFIG_PATH || DEFAULT_CONFIG_PATH);

  const gateway = new KubeGateway(process.env.KUBE_CONTEXT || undefined);

  // The history is kept per cluster, so pointing the app at another cluster does not mix them up.
  const history = new HistoryStore(process.env.DB_PATH || DEFAULT_DB_PATH, gateway.clusterName());
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
    const warnings: string[] = [];
    if (!existsSync(join(PAGE_FOLDER, "index.html"))) {
      warnings.push('The page is not built yet. Run "npm run build", then reload the browser.');
    }
    if (interrupted > 0) {
      warnings.push(`${interrupted} deployment(s) were left unfinished by the last run and are now marked "interrupted".`);
    }
    console.log(
      formatStartupBanner({
        url: `http://${HOST}:${port}`,
        context: gateway.contextName(),
        environments: Object.keys(config.environments),
        reader: reader.description,
        warnings,
      }),
    );
  });
}

try {
  start();
} catch (error) {
  // A problem with the config file is the reader's to fix: show the sentence, not a stack trace.
  if (error instanceof ConfigError) {
    console.error(formatStartupError(error.message));
    process.exit(1);
  }
  throw error;
}
