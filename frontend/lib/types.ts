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
  /** Requests the user could send instead. The page shows them as buttons that fill the message box. */
  suggestions?: string[];
}

/** One message of this tab's conversation, as the server stored it. */
export interface StoredMessage extends AgentReply {
  role: "user" | "agent";
  at: string;
}

/** The parts of a change that builds an image, in the order they happen. */
export type OperationStage = "repository" | "build" | "publish" | "pods";

export interface Operation {
  state: "running" | "succeeded" | "failed";
  /** Progress so far, oldest first: "1/3 pods ready", "2/3 pods ready", ... */
  steps: string[];
  /** The final message, once the operation is no longer running. */
  message: string;
  /** Set for a change that builds an image: every stage it goes through, in order. Left out, there is only the rollout. */
  stages?: OperationStage[];
  /** The stage that is running now, or the one that failed. */
  stage?: OperationStage;
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

/** How Rollo looks: resting, busy, pleased after good news, or uneasy after a problem. */
export type RolloMood = "idle" | "working" | "happy" | "worried";

/** One message on screen. */
export interface ChatItem {
  role: "user" | "agent";
  text: string;
  /** When it was said, as an ISO time. */
  at: string;
  /** An agent message that reports a failed request. */
  isError?: boolean;
  /** Set on an agent message that asks for confirmation. */
  action?: ActionRequest;
  /** Why Confirm and Cancel are switched off. Not set while the action is still open. */
  actionNote?: string;
  /** Set on an agent message about a change that was started. */
  operationId?: string;
  /** Set on an agent message that offers requests to try instead. */
  suggestions?: string[];
}

/** Who is asking: the tab's conversation and the name stored as "requested by". */
export interface Identity {
  sessionId: string;
  userName: string;
}

export interface PodProgress {
  ready: number;
  total: number;
}

export type HealthWord = "HEALTHY" | "DEGRADED" | "DOWN";

export type TextPart = { kind: "text"; text: string } | { kind: "status"; status: HealthWord };

export type ReplyLine =
  | { kind: "plain" | "note" | "bullet"; isLead: boolean; parts: TextPart[] }
  | { kind: "facts"; isLead: boolean; indent: number; facts: TextPart[][] };

export type FactsLine = Extract<ReplyLine, { kind: "facts" }>;

export type TextLine = Exclude<ReplyLine, FactsLine>;

/** A piece of a reply as the page draws it: one line of text, or a table of facts. */
export type ReplyBlock = { kind: "line"; line: TextLine } | { kind: "table"; rows: FactsLine[] };

/** "unknown" means the page can no longer ask the server about this change. */
export type RolloutState = "running" | "succeeded" | "failed" | "unknown";

export type StepState = "done" | "active" | "failed" | "pending";

export interface RolloutStep {
  id: "sent" | OperationStage | "finished";
  title: string;
  /** A short line under the title, or "" for none. */
  detail: string;
  state: StepState;
}

/** The stretch of the rollout track that belongs to one stage. 0 is the start of the track and 1 its end. */
export interface TrackPart {
  stage: OperationStage;
  start: number;
  end: number;
}

export type Tone = "healthy" | "degraded" | "down" | "neutral";

/** What the splash screen shows: the spinner, then "Ready", then it fades out and is taken off the page. */
export type SplashStage = "starting" | "ready" | "leaving" | "gone";
