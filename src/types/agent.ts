import type { SessionStore } from "@/agent/sessionStore.ts";
import type { DeploymentService } from "@/services/deploymentService.ts";
import type { HistoryStore } from "@/services/historyStore.ts";
import type { StatusService } from "@/services/statusService.ts";
import type { AppConfig, LlmSettings } from "@/types/config.ts";
import type { ChangePlan } from "@/types/deployment.ts";

export interface AgentReply {
  text: string;
  /** Set when the reply asks for confirmation: the browser shows Confirm and Cancel. */
  action?: { id: string; warning: string | null };
  /** Set when a change has started: the browser follows its progress by this ID. */
  operationId?: string;
  /** Requests the user could send instead. The browser shows them as buttons that fill the message box. */
  suggestions?: string[];
}

export interface AgentDeps {
  config: AppConfig;
  deployments: DeploymentService;
  statuses: StatusService;
  history: HistoryStore;
  sessions: SessionStore;
  /** How messages are read. Left out, the built-in rules read them. */
  reader?: MessageReader;
  /** The current time in milliseconds. Tests replace this. */
  now?: () => number;
}

export type IntentName =
  | "deploy"
  | "scale"
  | "rollback"
  | "health"
  | "usage"
  | "nodes"
  | "status"
  | "history"
  | "help";

export interface ParsedMessage {
  /** Null when the message names no action, for example the answer "staging" to a question. */
  intent: IntentName | null;
  app?: string;
  environment?: string;
  /** A word used where an environment was expected, but that is not one, for example "qa". */
  unknownEnvironment?: string;
  /** Image version, for example "v2". */
  version?: string;
  replicas?: number;
  /** How many history rows were asked for. */
  limit?: number;
  /** True for "my deployments": only those of the person asking. */
  mine?: boolean;
  /** Set for "which pod uses the most memory?". */
  topPodBy?: "cpu" | "memory";
}

export interface KnownNames {
  environments: string[];
  apps: string[];
}

export interface Reading {
  parsed: ParsedMessage;
  /** Set when OpenAI was meant to read the message but the rules did: the reason, written for the user. */
  fallbackNote?: string;
}

export interface MessageReader {
  /** How messages are read. Shown when the app starts and in the help text. */
  description: string;
  /** Reads one message. Never throws. */
  read(text: string, awaiting?: ParsedMessage): Promise<Reading>;
}

export interface MessageReaderOptions {
  known: KnownNames;
  /** The value of OPENAI_API_KEY. Missing or empty means: use the rules. */
  apiKey: string | undefined;
  llm: LlmSettings;
}

export interface ChatMessage {
  role: "user" | "agent";
  text: string;
  at: Date;
  /** Set on an agent message that asks for confirmation. */
  action?: { id: string; warning: string | null };
  /** Set on an agent message about a change that was started; progress is read by this ID. */
  operationId?: string;
  /** Set on an agent message that offers requests to try instead. */
  suggestions?: string[];
}

export interface PendingAction {
  id: string;
  plan: ChangePlan;
  createdAtMs: number;
}

export interface Session {
  id: string;
  messages: ChatMessage[];
  /** The app and environment last talked about, so "is it healthy?" knows what "it" is. */
  app?: string;
  environment?: string;
  /** The last question asked, so "what about prod?" can repeat it for prod. */
  lastQuestion?: ParsedMessage;
  /** A request that still misses a detail the agent has asked for. */
  awaiting?: ParsedMessage;
  /** A change that waits for Confirm or Cancel. At most one at a time. */
  pending?: PendingAction;
}
