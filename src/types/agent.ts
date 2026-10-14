import type { SessionStore } from "@/agent/sessionStore.ts";
import type { DeploymentService } from "@/services/deploymentService.ts";
import type { HistoryStore } from "@/services/historyStore.ts";
import type { ServiceRegistry } from "@/services/serviceRegistry.ts";
import type { StatusService } from "@/services/statusService.ts";
import type { AppConfig, LlmSettings } from "@/types/config.ts";
import type { ChangePlan } from "@/types/deployment.ts";
import type { ServiceFlow } from "@/types/wizard.ts";

export interface AgentReply {
  text: string;
  /** Set when the reply asks for confirmation: the browser shows Confirm and Cancel. */
  action?: { id: string; warning: string | null };
  /** Set when a change has started: the browser follows its progress by this ID. */
  operationId?: string;
  /** Set when the reply could not help: the browser shows what the assistant can do, as cards to click. */
  showCapabilities?: boolean;
}

export interface AgentDeps {
  config: AppConfig;
  deployments: DeploymentService;
  statuses: StatusService;
  history: HistoryStore;
  sessions: SessionStore;
  /** The services the chat can talk about. */
  registry: ServiceRegistry;
  /** How messages are read. Left out, the built-in rules read them. */
  reader?: MessageReader;
  /** The questions for creating or changing a service. Left out, the LangGraph workflow in serviceFlow.ts. */
  questions?: ServiceFlow;
  /** The current time in milliseconds. Tests replace this. */
  now?: () => number;
}

export type IntentName =
  | "create"
  | "edit"
  | "deploy"
  | "scale"
  | "rollback"
  | "health"
  | "usage"
  | "nodes"
  | "status"
  | "history"
  | "help"
  /** A question or remark the model answers in words: no action and no live data. Only OpenAI gives this. */
  | "chat";

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
  /** The model's own answer, for a "chat" message. */
  reply?: string;
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
  /** Reads one message. `recent` is the conversation before it, oldest first. Never throws. */
  read(text: string, awaiting?: ParsedMessage, recent?: RecentMessage[]): Promise<Reading>;
}

/** One earlier message of the conversation, as the model may see it. */
export interface RecentMessage {
  role: "user" | "agent";
  text: string;
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
  /** Set on an agent message that shows what the assistant can do. */
  showCapabilities?: boolean;
  /** Set on messages of the service questions: folder paths and variables are never sent to OpenAI. */
  hiddenFromModel?: boolean;
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
  /** Set while the questions for a service are open: which kind, and the name of their conversation in the question flow. */
  questions?: OpenQuestions;
}

export interface OpenQuestions {
  kind: "create" | "edit";
  /** The conversation's own name in the question flow. A new one for every "create" or "edit". */
  thread: string;
}
