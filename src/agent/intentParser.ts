import { ENVIRONMENT_ALIASES, INTENT_RULES, NOT_AN_ENVIRONMENT } from "@/constants/agent.ts";
import type { IntentName, KnownNames, ParsedMessage } from "@/types/agent.ts";

export function escapeForRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when `word` appears as a whole word. Dashes count as part of a word, as in "sample-app". */
export function hasWord(lowerText: string, word: string): boolean {
  return new RegExp(`(^|[^a-z0-9-])${escapeForRegex(word)}($|[^a-z0-9-])`).test(lowerText);
}

function findIntent(lowerText: string): IntentName | null {
  for (const [intent, pattern] of INTENT_RULES) {
    if (pattern.test(lowerText)) {
      return intent;
    }
  }
  return null;
}

/** The known environment named in the text, by its name or an alias such as "production". */
export function findEnvironment(lowerText: string, environments: string[]): string | undefined {
  for (const environment of environments) {
    if (hasWord(lowerText, environment)) {
      return environment;
    }
  }
  for (const [alias, environment] of Object.entries(ENVIRONMENT_ALIASES)) {
    if (environments.includes(environment) && hasWord(lowerText, alias)) {
      return environment;
    }
  }
  return undefined;
}

/** The word after a trailing "to", "in", "of", "for" or "on", as in "deploy v2 to qa". */
function findUnknownEnvironment(lowerText: string, known: KnownNames): string | undefined {
  const match = /\b(?:to|in|of|for|on)\s+([a-z][a-z0-9-]*)\s*\??\s*$/.exec(lowerText);
  const word = match?.[1];
  if (word === undefined || NOT_AN_ENVIRONMENT.has(word) || known.apps.includes(word)) {
    return undefined;
  }
  return word;
}

/** Looks for an image version. Reads the original text, because versions are case-sensitive. */
function findVersion(text: string, apps: string[]): string | undefined {
  // "sample-app:v2"
  for (const app of apps) {
    const withApp = new RegExp(`${escapeForRegex(app)}:([A-Za-z0-9_][\\w.-]*)`, "i").exec(text);
    if (withApp?.[1]) {
      return withApp[1];
    }
  }
  const patterns = [
    /\b(?:version|tag|image)\s*[:=]?\s*([A-Za-z0-9_][\w.-]*)/i, // "version v2", "tag 1.4.0"
    /\b(v\d[\w.-]*)/i, // "v2", "v2.1-rc1"
    /\b(\d+(?:\.\d+)+)\b/, // "1.4.0"
    /\b(latest)\b/i, // named so the assistant can explain why it refuses it
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

function findReplicas(lowerText: string): number | undefined {
  const match =
    /(\d+)\s*(?:replicas?|pods?|instances?|copies)\b/.exec(lowerText) ?? // "5 replicas"
    /\bto\s+(\d+)\b/.exec(lowerText) ?? // "scale prod to 2"
    /^\s*(\d+)\s*$/.exec(lowerText); // a bare "5" as the answer to "how many?"
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

export function parseMessage(text: string, known: KnownNames): ParsedMessage {
  const lowerText = text.toLowerCase();
  const intent = findIntent(lowerText);
  const parsed: ParsedMessage = { intent };

  const app = known.apps.find((name) => hasWord(lowerText, name));
  if (app !== undefined) {
    parsed.app = app;
  }

  const environment = findEnvironment(lowerText, known.environments);
  if (environment !== undefined) {
    parsed.environment = environment;
  } else if (intent !== null && intent !== "help" && intent !== "nodes") {
    const unknownEnvironment = findUnknownEnvironment(lowerText, known);
    if (unknownEnvironment !== undefined) {
      parsed.unknownEnvironment = unknownEnvironment;
    }
  }

  if (intent === "deploy" || intent === null) {
    const version = findVersion(text, known.apps);
    if (version !== undefined) {
      parsed.version = version;
    }
  }
  if (intent === "scale" || (intent === null && parsed.version === undefined)) {
    const replicas = findReplicas(lowerText);
    if (replicas !== undefined) {
      parsed.replicas = replicas;
    }
  }
  if (intent === "history") {
    const limit = /\b(?:last|latest|recent)\s+(\d+)\b/.exec(lowerText) ?? /\b(\d+)\s+deployments\b/.exec(lowerText);
    if (limit?.[1] !== undefined) {
      parsed.limit = Number(limit[1]);
    }
    if (/\b(my|mine|i)\b/.test(lowerText)) {
      parsed.mine = true;
    }
  }
  if (intent === "usage" && /\bpods?\b/.test(lowerText) && /\b(most|highest|top|max)\b/.test(lowerText)) {
    parsed.topPodBy = /\bcpu\b/.test(lowerText) ? "cpu" : "memory";
  }

  return parsed;
}
