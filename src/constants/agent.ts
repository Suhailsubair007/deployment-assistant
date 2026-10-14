import type { IntentName } from "@/types/agent.ts";
import type { ChangePlan } from "@/types/deployment.ts";

export const CONFIRMATION_LIFETIME_MS = 10 * 60 * 1000;
export const CONFIRMATION_INVALID = "That confirmation is no longer valid. Please ask again.";
export const CONFIRMATION_EXPIRED = "That confirmation has expired. Please ask again.";
export const CANCELLED = "Cancelled. Nothing was changed.";
// It lists what the assistant can do and blames nobody: the message may be off-topic,
// or a real request in words the reader does not know.
export const NOT_UNDERSTOOD = "I didn't quite catch that. Here is what I can help with: pick one, or say it in other words.";
export const RULES_DESCRIPTION =
  "Messages are read by built-in rules. The LLM is not configured (OPENAI_API_KEY is not set).";

export const DEFAULT_HISTORY_ROWS = 5;

export const MAX_HISTORY_ROWS = 50;

export const STARTED_MESSAGES: Record<ChangePlan["action"], string> = {
  deploy: "Rolling update started",
  rollback: "Rollback started",
  scale: "Scaling started",
  create: "Creating the service",
  configure: "Applying the new settings",
};

// Said instead of the line above when the image is built first.
export const BUILD_STARTED = "Build started";

// Said when another request is typed while the questions for a service are being asked.
// Nothing else is carried out until the questions are answered or cancelled.
export const WIZARD_BUSY: Record<"create" | "edit", string> = {
  create:
    "You are in the middle of creating a service, so I did not act on that. Answer the question below, or type cancel to stop.",
  edit: "You are in the middle of changing a service, so I did not act on that. Answer the question below, or type cancel to stop.",
};

export const INTENT_RULES: [IntentName, RegExp][] = [
  ["create", /\bcreate\b|\bnew (?:service|app)\b|\badd (?:a |an )?(?:new )?(?:service|app)\b/],
  ["edit", /\bedit\b|\bsettings\b|\bconfigure\b/],
  ["rollback", /\broll\s?-?back\b|\brevert\b|\bundo\b/],
  ["scale", /\bscale\b|\breplicas?\b/],
  ["history", /\bdeployments\b|\bhistory\b/],
  ["nodes", /\bnodes?\b/],
  ["status", /\bstatus\b|\boverview\b/],
  ["usage", /\bcpu\b|\bmemory\b|\bram\b|\bresources?\b|\busage\b/],
  ["health", /\bhealthy?\b/],
  ["deploy", /\bdeploy\b|\brelease\b|\bship\b/],
  ["health", /\b(ok|okay|up|alive|working|running)\b/],
  ["help", /\bhelp\b|what can you do|\bcommands\b/],
];

// Other words people use for an environment.
export const ENVIRONMENT_ALIASES: Record<string, string> = { production: "prod", stage: "staging" };

// One typing mistake is forgiven in an environment name of at least this many letters ("stagin").
// A shorter name must be spelled right: one letter off is often another word, as "pod" is for "prod".
export const SHORTEST_NAME_WITH_TYPO = 6;

// Words that can follow "to", "in", "of" at the end of a sentence without being an environment.
export const NOT_AN_ENVIRONMENT = new Set(["it", "them", "there", "here", "total", "use", "now", "this", "that"]);

// What Kubernetes' short termination reasons mean.
export const TERMINATION_MEANINGS: Record<string, string> = {
  OOMKilled: "killed for using more memory than its limit",
  Error: "the app exited with an error",
  Completed: "the app exited by itself",
  ContainerCannotRun: "the container could not be started",
};

export const MAX_SESSIONS = 500;

export const MAX_MESSAGES = 200;
