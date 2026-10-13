// The shapes of the JSON our web API returns. They mirror the server's own types
// (AgentReply, ChatMessage, Operation, EnvironmentSummary). Dates arrive as text.

/** Set on a reply that asks for confirmation. */
export interface ActionRequest {
  id: string;
  /** The extra warning for a protected environment such as prod, or null. */
  warning: string | null;
}

export interface AgentReply {
  text: string;
  /** The page shows Confirm and Cancel for it. */
  action?: ActionRequest;
  /** A change has started; the page follows its progress by this ID. */
  operationId?: string;
}

/** One message of this tab's conversation, as the server stored it. */
export interface StoredMessage extends AgentReply {
  role: "user" | "agent";
  at: string;
}

export interface Operation {
  state: "running" | "succeeded" | "failed";
  /** Progress so far, oldest first: "1/3 pods ready", "2/3 pods ready", ... */
  steps: string[];
  /** The final message, once the operation is no longer running. */
  message: string;
}

export type EnvironmentStatus = "HEALTHY" | "DEGRADED" | "DOWN" | "NOT DEPLOYED" | "UNKNOWN";

/** One card of the status panel. */
export interface EnvironmentSummary {
  environment: string;
  app: string;
  status: EnvironmentStatus;
  /** Why the status is what it is. Empty when HEALTHY. */
  reason: string;
  image: string | null;
  lastUpdate: string | null;
}
