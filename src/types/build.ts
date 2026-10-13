import type { AppConfig } from "@/types/config.ts";

/** The only programs the assistant ever runs. */
export type AllowedProgram = "docker" | "kind" | "aws" | "terraform";

export interface CommandOptions {
  /** The program is stopped, and the command fails, after this long. */
  timeoutMs: number;
  /** Folder the program runs in. */
  cwd?: string;
  /** Extra environment variables for this one program, on top of the assistant's own. */
  env?: Record<string, string>;
  /** Text handed to the program on its standard input, for example a password. It never appears in the arguments. */
  input?: string;
  /** True when what the program prints is a secret: it is returned but never logged. */
  secretOutput?: boolean;
}

/**
 * Runs one program with a list of arguments (never a shell string) and resolves with
 * what it printed. Throws CommandFailedError when the program is missing, exits with
 * an error or takes too long.
 */
export type RunCommand = (program: AllowedProgram, args: string[], options: CommandOptions) => Promise<string>;

/** What kind of cluster the assistant is connected to, worked out from the cluster's name in the kubeconfig. */
export type ClusterTarget =
  | { kind: "kind"; /** Name of the kind cluster, for "kind load docker-image --name". */ kindCluster: string }
  | {
      kind: "eks";
      region: string;
      account: string;
      /** The cluster's short name, for example "deployment-assistant-staging". */
      cluster: string;
      /** Put in front of image names: "<account>.dkr.ecr.<region>.amazonaws.com/<cluster>". */
      registry: string;
    }
  | { kind: "other" };

export interface ImageBuilder {
  /** Builds the image from the Dockerfile in the folder. */
  build(folder: string, image: string): Promise<void>;
  /** Makes the image reachable for the cluster: loaded into kind, or pushed to the registry. */
  publish(image: string): Promise<void>;
}

export interface ServiceInfra {
  /** Creates what the service needs outside the cluster (its image repository). Safe to repeat. */
  ensure(service: string): Promise<void>;
}

/** Everything needed to turn a project folder into an image the cluster can run. */
export interface BuildTools {
  /** Put in front of image names. Empty for local images (kind). */
  registry: string;
  /** Null when the assistant cannot build for this kind of cluster. */
  builder: ImageBuilder | null;
  /** Null when nothing has to be prepared outside the cluster (kind). */
  infra: ServiceInfra | null;
}

export interface BuildToolsDeps {
  /** The cluster's name in the kubeconfig: "kind-deploy-assistant", or an EKS ARN. */
  clusterName: string;
  run: RunCommand;
  config: AppConfig;
  /** AWS profile for the image repository and the upload. Left out, the programs use the assistant's own environment. */
  awsProfile?: string;
  /** Bucket that holds the Terraform state. Left out, it is the name the bootstrap stack gives it. */
  stateBucket?: string;
  /** Value of the "owner" tag on what Terraform creates. */
  owner?: string;
}

export interface CommandRunnerDeps {
  /** Where the command lines and the programs' output go. Left out, they go to the server log. */
  log?: (line: string) => void;
  /** The file started for a program name. Left out, the name is looked up on the PATH. Tests point them at Node. */
  programs?: Record<string, string>;
  /** How long a program that was asked to stop gets before it is stopped the hard way. Tests shorten this. */
  stopGraceMs?: number;
}

/** The EKS case of ClusterTarget: the cluster's region, account, name and registry. */
export type EksTarget = Extract<ClusterTarget, { kind: "eks" }>;

export interface KindImageBuilderDeps {
  run: RunCommand;
  /** Name of the kind cluster the images are loaded into. */
  kindCluster: string;
  /** Give up on one build or one load after this long. */
  timeoutMs: number;
}

export interface EcrImageBuilderDeps {
  run: RunCommand;
  target: EksTarget;
  /** AWS profile for the upload. Left out, aws uses the assistant's own environment. */
  awsProfile?: string;
  /** Give up on one build or one upload after this long. */
  timeoutMs: number;
}

export interface TerraformServiceInfraDeps {
  run: RunCommand;
  target: EksTarget;
  /** AWS profile for aws and Terraform. Left out, they use the assistant's own environment. */
  awsProfile?: string;
  /** Bucket that holds the Terraform state. Left out, it is the name the bootstrap stack gives it. */
  stateBucket?: string;
  /** Value of the "owner" tag on what Terraform creates. Left out, it is "deployment-assistant". */
  owner?: string;
  /** Folder of the Terraform stack. Left out, it is terraform/service in this project. */
  stackFolder?: string;
  /** Give up on one aws or Terraform command after this long. */
  timeoutMs: number;
}

/** What the assistant learned by looking at a project folder. */
export interface ProjectInfo {
  /** The folder's full path, with "~" and links resolved. */
  folder: string;
  /** The port named by EXPOSE in the Dockerfile; null when there is none. */
  port: number | null;
  /** A service name made from the folder's name; null when the name cannot be used. */
  suggestedName: string | null;
}
