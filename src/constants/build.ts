import { join } from "node:path";

import type { AllowedProgram } from "@/types/build.ts";

/** The only programs the assistant ever starts. */
export const ALLOWED_PROGRAMS: AllowedProgram[] = ["docker", "kind", "aws", "terraform"];

/** How much of a program's output is kept: the end of it, about 200 lines. A very long build cannot fill memory. */
export const KEPT_OUTPUT_CHARS = 20_000;

/** The most that is quoted from a program's last line when a command fails. */
export const MAX_REASON_CHARS = 300;

/** A program that was asked to stop gets this long before it is stopped the hard way. */
export const STOP_GRACE_MS = 10_000;

// The name kind gives a cluster in the kubeconfig: "kind-deploy-assistant".
export const KIND_CLUSTER_PATTERN = /^kind-(?<name>[a-z0-9][a-z0-9.-]*)$/;

// The name of an EKS cluster in the kubeconfig:
// "arn:aws:eks:ap-south-1:123456789012:cluster/deployment-assistant-staging".
export const EKS_CLUSTER_PATTERN =
  /^arn:aws:eks:(?<region>[a-z0-9-]+):(?<account>\d{12}):cluster\/(?<cluster>[A-Za-z0-9][A-Za-z0-9_-]*)$/;

// The cluster's machines are x86. A Mac with Apple silicon would otherwise build arm64 images they cannot run.
export const EKS_IMAGE_PLATFORM = "linux/amd64";

/** The Terraform stack that creates what one service needs outside the cluster. */
export const SERVICE_STACK_FOLDER = join(import.meta.dirname, "../../terraform/service");

/** Start of the state bucket's name. The bootstrap stack adds the account and the region to it. */
export const STATE_BUCKET_PREFIX = "deployment-assistant-tfstate";

/** Where the services' state files live inside the bucket. "<cluster>/<service>/terraform.tfstate" follows it. */
export const SERVICE_STATE_FOLDER = "deployment-assistant/services";

/** The "owner" tag on what Terraform creates, unless TF_OWNER says otherwise. */
export const DEFAULT_OWNER = "deployment-assistant";
