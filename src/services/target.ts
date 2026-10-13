import { NotFoundError } from "@/errors.ts";
import type { ClusterGateway, DeploymentInfo } from "@/types/cluster.ts";

/** The app's Deployment, or null when the app is not deployed. */
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
