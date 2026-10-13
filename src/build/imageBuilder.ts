import { EKS_IMAGE_PLATFORM } from "@/constants/build.ts";
import type { CommandOptions, EcrImageBuilderDeps, ImageBuilder, KindImageBuilderDeps } from "@/types/build.ts";

/** Builds images for the local kind cluster, like scripts/kind-up.sh does. */
export function createKindImageBuilder(deps: KindImageBuilderDeps): ImageBuilder {
  const { run, kindCluster, timeoutMs } = deps;

  return {
    async build(folder, image) {
      await run("docker", ["build", "--tag", image, folder], { timeoutMs });
    },

    async publish(image) {
      // kind cannot pull from the laptop's Docker, so the image is copied into the cluster's node.
      await run("kind", ["load", "docker-image", image, "--name", kindCluster], { timeoutMs });
    },
  };
}

/** Builds images for an EKS cluster and pushes them to its registry (ECR), like scripts/push-sample-app.sh does. */
export function createEcrImageBuilder(deps: EcrImageBuilderDeps): ImageBuilder {
  const { run, target, awsProfile, timeoutMs } = deps;
  // "123456789012.dkr.ecr.ap-south-1.amazonaws.com/staging": docker logs in to the part before the first slash.
  const registryHost = target.registry.split("/")[0] ?? target.registry;
  // Only aws is told which profile to use. Docker does not need it.
  const awsOptions: CommandOptions = awsProfile ? { timeoutMs, env: { AWS_PROFILE: awsProfile } } : { timeoutMs };

  return {
    async build(folder, image) {
      await run("docker", ["build", "--platform", EKS_IMAGE_PLATFORM, "--tag", image, folder], { timeoutMs });
    },

    async publish(image) {
      // Docker gets a 12-hour password for the registry from the AWS CLI.
      const password = await run("aws", ["ecr", "get-login-password", "--region", target.region], {
        ...awsOptions,
        secretOutput: true,
      });
      // The password goes in through standard input, so it never shows up in the arguments or in a log.
      await run("docker", ["login", "--username", "AWS", "--password-stdin", registryHost], {
        timeoutMs,
        input: password,
      });
      await run("docker", ["push", image], { timeoutMs });
    },
  };
}
