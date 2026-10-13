import { existsSync } from "node:fs";
import { join } from "node:path";

import { Agent } from "@/agent/agent.ts";
import { liveNames } from "@/agent/knownNames.ts";
import { createMessageReader } from "@/agent/messageReader.ts";
import { SessionStore } from "@/agent/sessionStore.ts";
import { createApp } from "@/api/routes.ts";
import { createBuildTools } from "@/build/buildTools.ts";
import { createCommandRunner } from "@/build/commandRunner.ts";
import { KubeGateway } from "@/cluster/kubeGateway.ts";
import { ConfigError, loadConfig } from "@/config.ts";
import { DEFAULT_CONFIG_PATH, DEFAULT_DB_PATH, DEFAULT_PORT, HOST, PAGE_FOLDER } from "@/constants/server.ts";
import { DeploymentService } from "@/services/deploymentService.ts";
import { FailureExplainer } from "@/services/failureExplainer.ts";
import { HistoryStore } from "@/services/historyStore.ts";
import { MetricsService } from "@/services/metricsService.ts";
import { OperationStore } from "@/services/operationStore.ts";
import { ServiceRegistry } from "@/services/serviceRegistry.ts";
import { StatusService } from "@/services/statusService.ts";
import { formatStartupBanner, formatStartupError } from "@/startupBanner.ts";

const port = Number(process.env.PORT || DEFAULT_PORT);

function start(): void {
  const config = loadConfig(process.env.CONFIG_PATH || DEFAULT_CONFIG_PATH);

  const gateway = new KubeGateway(process.env.KUBE_CONTEXT || undefined);

  // The history is kept per cluster, so pointing the app at another cluster does not mix them up.
  const dbPath = process.env.DB_PATH || DEFAULT_DB_PATH;
  const history = new HistoryStore(dbPath, gateway.clusterName());
  const interrupted = history.recoverInterrupted();
  // The services created from the chat live in the same file, also per cluster.
  const registry = new ServiceRegistry({ path: dbPath, cluster: gateway.clusterName(), config });

  const operations = new OperationStore();
  const sessions = new SessionStore();
  const explainer = new FailureExplainer(gateway);
  const statuses = new StatusService({
    gateway,
    history,
    config,
    registry,
    explainer,
    metrics: new MetricsService(gateway),
  });
  // What turns a project folder into an image the cluster can run. Which programs that
  // takes (docker and kind, or docker, aws and terraform) follows from the cluster in use.
  const build = createBuildTools({
    clusterName: gateway.clusterName(),
    run: createCommandRunner(),
    config,
    awsProfile: process.env.AWS_BUILD_PROFILE || undefined,
    stateBucket: process.env.TF_STATE_BUCKET || undefined,
    owner: process.env.TF_OWNER || undefined,
  });
  const deployments = new DeploymentService({
    gateway,
    history,
    operations,
    config,
    registry,
    explainer,
    imageRegistry: process.env.IMAGE_REGISTRY || undefined,
    build,
  });
  const reader = createMessageReader({
    known: liveNames(config, registry),
    apiKey: process.env.OPENAI_API_KEY,
    llm: config.llm,
  });
  const agent = new Agent({ config, deployments, statuses, history, sessions, registry, reader });

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
