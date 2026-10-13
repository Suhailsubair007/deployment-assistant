import { EKS_CLUSTER_PATTERN, KIND_CLUSTER_PATTERN } from "@/constants/build.ts";
import type { ClusterTarget } from "@/types/build.ts";

/**
 * Works out what kind of cluster this is from its name in the kubeconfig. That decides
 * where a built image has to go: into the kind cluster, or to the cluster's registry on AWS.
 */
export function describeCluster(clusterName: string): ClusterTarget {
  const kind = KIND_CLUSTER_PATTERN.exec(clusterName)?.groups;
  if (kind !== undefined) {
    return { kind: "kind", kindCluster: kind.name };
  }

  const eks = EKS_CLUSTER_PATTERN.exec(clusterName)?.groups;
  if (eks !== undefined) {
    const { region, account, cluster } = eks;
    return {
      kind: "eks",
      region,
      account,
      cluster,
      // Each cluster has its own corner of the account's registry, named after the cluster.
      registry: `${account}.dkr.ecr.${region}.amazonaws.com/${cluster}`,
    };
  }

  return { kind: "other" };
}
