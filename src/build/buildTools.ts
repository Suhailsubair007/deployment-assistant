import { describeCluster } from "@/build/clusterTarget.ts";
import { createEcrImageBuilder, createKindImageBuilder } from "@/build/imageBuilder.ts";
import { createTerraformServiceInfra } from "@/build/serviceInfra.ts";
import type { BuildTools, BuildToolsDeps } from "@/types/build.ts";

/**
 * Picks the tools that fit the cluster in use:
 *   kind  - docker builds, kind loads the image into the cluster. Nothing to prepare outside it.
 *   EKS   - docker builds and pushes to the cluster's registry; Terraform creates the repository first.
 *   other - the assistant does not know where images for this cluster have to go, so it cannot build.
 */
export function createBuildTools(deps: BuildToolsDeps): BuildTools {
  const { run, awsProfile } = deps;
  const timeoutMs = deps.config.build.timeoutSeconds * 1000;
  const target = describeCluster(deps.clusterName);

  if (target.kind === "kind") {
    return {
      registry: "",
      builder: createKindImageBuilder({ run, kindCluster: target.kindCluster, timeoutMs }),
      infra: null,
    };
  }

  if (target.kind === "eks") {
    return {
      registry: target.registry,
      builder: createEcrImageBuilder({ run, target, awsProfile, timeoutMs }),
      infra: createTerraformServiceInfra({
        run,
        target,
        awsProfile,
        stateBucket: deps.stateBucket,
        owner: deps.owner,
        timeoutMs,
      }),
    };
  }

  return { registry: "", builder: null, infra: null };
}
