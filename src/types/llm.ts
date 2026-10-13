import type { IntentName, KnownNames } from "@/types/agent.ts";

export interface OpenAiModelSettings {
  apiKey: string;
  model: string;
  /** Give up on one call after this long. */
  timeoutMs: number;
  /** How the network call is made. Tests replace this, so they send nothing to OpenAI. */
  fetch?: typeof fetch;
}

/** A tool as the model sees it: a name, what it is for, and the details it takes (a JSON Schema). */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
}

/** The tool the model picked for a message, with the details it filled in. */
export interface ToolCall {
  name: string;
  /** Whatever the model sent. It is checked before it is used. */
  args: unknown;
}

export interface ModelRequest {
  /** What the model is for, and the rules it must follow. */
  instructions: string;
  /** The user's message, with the open question when there is one. */
  message: string;
  tools: ToolDefinition[];
}

/** Asks the model to pick a tool. Throws ModelUnavailableError, with a sentence for the user, when it cannot. */
export type AskModel = (request: ModelRequest) => Promise<ToolCall>;

export interface OpenAiReaderDeps {
  known: KnownNames;
  askModel: AskModel;
  /** Name of the model, for the description. */
  model: string;
  /** After a failure, the rules read every message for this long. */
  retryAfterSeconds: number;
  /** The current time in milliseconds. Tests replace this. */
  now?: () => number;
  /** Where failures are logged. Tests silence it. */
  log?: (...parts: unknown[]) => void;
}
export type Detail = "app" | "environment" | "version" | "replicas" | "limit" | "mine" | "topPodBy";

export interface Tool {
  /** The intent the Agent gets. Null for the two tools that name no action. */
  intent: IntentName | null;
  description: string;
  /** The details this tool takes. A health question, for example, has no replicas. */
  details: Detail[];
}
