import type { ProjectInfo } from "@/types/build.ts";
import type { ResourceAmounts, ServiceDefaults } from "@/types/config.ts";
import type { EnvVar, ServiceSpec } from "@/types/service.ts";

/** One question of the conversation that creates or edits a service. "change" asks which setting to edit. */
export type WizardField =
  | "folder"
  | "name"
  | "environment"
  | "port"
  | "healthPath"
  | "cpu"
  | "memory"
  | "replicas"
  | "maxReplicas"
  | "variables"
  | "change";

/** The answers given so far. */
export interface ServiceDraft {
  folder?: string;
  name?: string;
  environment?: string;
  port?: number;
  healthPath?: string;
  /** Reserved amounts (requests) and maximums (limits). CPU and memory are asked separately. */
  requests?: Partial<ResourceAmounts>;
  limits?: Partial<ResourceAmounts>;
  replicas?: number;
  maxReplicas?: number;
  env?: EnvVar[];
  /** What the folder check found: used for the default port and name. */
  project?: ProjectInfo;
}

/** A conversation in progress. Kept in the session between two messages. */
export interface Wizard {
  kind: "create" | "edit";
  /** The question that was asked last and is waiting for its answer. */
  field: WizardField;
  draft: ServiceDraft;
  /** Edit only: the service as it is now. */
  original?: ServiceSpec;
}

/** What the questions need to know about the world. Handed in, so the questions themselves stay pure. */
export interface WizardContext {
  environments: string[];
  defaults: ServiceDefaults;
  /** True when a service of this name already exists in the environment. */
  exists(environment: string, name: string): boolean;
  /** Checks a project folder. Throws InvalidRequestError with a sentence for the user. */
  inspect(path: string): ProjectInfo;
}

export type WizardStep =
  /**
   * Ask (or ask again, after a bad answer): `text` is the reply, `wizard` the state to keep.
   * `rejected` is true when the answer was not accepted and the same question is asked again.
   */
  | { kind: "ask"; wizard: Wizard; text: string; rejected?: boolean; /** The question alone, without any error sentence. */ question: string }
  | { kind: "cancelled"; text: string }
  /** Every answer is in: the finished settings. For an edit, `spec` is the original with the change applied. */
  | { kind: "done"; spec: ServiceSpec };
