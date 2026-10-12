// Small helpers shared by the services: turning the environment and app a user named
// into the namespace and settings to use, and finding the app's Deployment.

import type { ClusterGateway, DeploymentInfo } from "../cluster/gateway.ts";
import type { AppConfig, AppDefaults } from "../config.ts";
import { InvalidRequestError, NotFoundError } from "../errors.ts";

export interface Target {
  /** The Kubernetes namespace of the environment. */
  namespace: string;
  /** The app's settings from the config file. */
  defaults: AppDefaults;
}

/** Throws InvalidRequestError, naming what is known, when the environment or app is not in the config file. */
export function resolveTarget(config: AppConfig, environment: string, app: string): Target {
  if (!Object.hasOwn(config.environments, environment)) {
    const known = Object.keys(config.environments).join(", ");
    throw new InvalidRequestError(`There is no environment called "${environment}". I know: ${known}.`);
  }
  if (!Object.hasOwn(config.apps, app)) {
    const known = Object.keys(config.apps).join(", ");
    throw new InvalidRequestError(`I don't know an app called "${app}". I know: ${known}.`);
  }
  return { namespace: config.environments[environment].namespace, defaults: config.apps[app] };
}

/**
 * The app's Deployment, or null when the app is not deployed.
 * Throws NotFoundError when the namespace itself is missing, because that needs a
 * different fix (create the namespace) than "deploy the app".
 */
export async function findDeployment(
  gateway: ClusterGateway,
  namespace: string,
  app: string,
): Promise<DeploymentInfo | null> {
  const deployment = await gateway.getDeployment(namespace, app);
  if (deployment === null && !(await gateway.namespaceExists(namespace))) {
    throw new NotFoundError(`Namespace "${namespace}" does not exist in this cluster.`, "namespaces");
  }
  return deployment;
}
