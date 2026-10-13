import type { Detail, Tool, ToolDefinition } from "@/types/llm.ts";

export const ANSWER_NOT_USABLE = "OpenAI's answer was not usable.";

export const UNEXPECTED_ERROR = "OpenAI could not be used because of an unexpected error.";

// Everything the model can say. Nothing outside this list is accepted.
export const TOOLS: Record<string, Tool> = {
  deploy: {
    intent: "deploy",
    description: "Deploy, release or ship a version of an app to an environment.",
    details: ["app", "version", "environment"],
  },
  scale: {
    intent: "scale",
    description: "Change how many replicas (pods, instances, copies) an app runs.",
    details: ["app", "environment", "replicas"],
  },
  roll_back: {
    intent: "rollback",
    description: "Return an app to the version it ran before: roll back, revert, undo.",
    details: ["app", "environment"],
  },
  check_health: {
    intent: "health",
    description: "Say whether an app is healthy, up, working or broken.",
    details: ["app", "environment"],
  },
  show_usage: {
    intent: "usage",
    description: "Show the CPU and memory an app uses, or which pod uses the most.",
    details: ["app", "environment", "topPodBy"],
  },
  show_nodes: {
    intent: "nodes",
    description: "Show the cluster's nodes (machines, servers) and how loaded they are.",
    details: [],
  },
  full_status: {
    intent: "status",
    description: "Give the full status or overview of an app in an environment.",
    details: ["app", "environment"],
  },
  list_deployments: {
    intent: "history",
    description: "List past deployments: the history of what was deployed, by whom and when.",
    details: ["environment", "limit", "mine"],
  },
  show_help: {
    intent: "help",
    description: "Explain what the assistant can do.",
    details: [],
  },
  create_service: {
    intent: "create",
    description:
      "Create, add or set up a new service (app) from a project folder on the user's machine. The assistant then asks for the details itself.",
    details: ["environment"],
  },
  edit_service: {
    intent: "edit",
    description:
      "Change the settings of an existing app: its CPU, memory, port, health check path, environment variables or maximum replicas. Not the number of replicas (that is scale) and not the version (that is deploy).",
    details: ["app", "environment"],
  },
  give_details: {
    intent: null,
    description:
      'The message names no action and only supplies details: an answer to a question the assistant asked, or a follow-up such as "what about prod?".',
    details: ["app", "environment", "version", "replicas"],
  },
  not_understood: {
    intent: null,
    description: "The message is none of the above.",
    details: [],
  },
};

// How each detail is described to the model. Every detail may be null: "the user did not say".
export const DETAIL_SCHEMAS: Record<Detail, Record<string, unknown>> = {
  app: { type: ["string", "null"], description: "The app the user named." },
  environment: {
    type: ["string", "null"],
    description: "The environment the user named in this message, as they wrote it. Never guess it.",
  },
  version: {
    type: ["string", "null"],
    description: 'The image version or tag exactly as the user wrote it, for example "v2" or "1.4.0".',
  },
  replicas: { type: ["integer", "null"], description: "How many replicas the user asked for, as a number." },
  limit: { type: ["integer", "null"], description: "How many deployments to list." },
  mine: { type: ["boolean", "null"], description: "True when the user asks only for their own deployments." },
  topPodBy: {
    type: ["string", "null"],
    // null must be in the list too. Without it the model has to pick "cpu" or "memory" for
    // every usage question, and the answer is one pod instead of the usage of the app.
    enum: ["cpu", "memory", null],
    description: "Set only when the user asks which single pod uses the most CPU or the most memory.",
  },
};

export const TOOL_DEFINITIONS: ToolDefinition[] = Object.entries(TOOLS).map(([name, tool]) => ({
  name,
  description: tool.description,
  parameters: {
    type: "object",
    properties: Object.fromEntries(tool.details.map((detail) => [detail, DETAIL_SCHEMAS[detail]])),
    required: tool.details,
    additionalProperties: false,
  },
}));
// The same shape the manifest builder accepts for an image version.
export const VERSION_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

export const ENVIRONMENT_NAME_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
