// How a chat message becomes the details the Agent works with. There are two readers:
//
//   rules    the patterns in intentParser.ts. Always available; needs nothing.
//   OpenAI   a model picks from a fixed list of tools (openAiReader.ts). Used when an
//            API key is set, and falls back to the rules whenever OpenAI cannot be used.
//
// Both give the same ParsedMessage, so the Agent does not care which one read a message.

import type { LlmSettings } from "../config.ts";
import { parseMessage } from "./intentParser.ts";
import type { KnownNames, ParsedMessage } from "./intentParser.ts";
import { createOpenAiModel } from "./openAiModel.ts";
import { createOpenAiReader } from "./openAiReader.ts";

export interface Reading {
  parsed: ParsedMessage;
  /** Set when OpenAI was meant to read the message but the rules did: the reason, written for the user. */
  fallbackNote?: string;
}

export interface MessageReader {
  /** How messages are read. Shown when the app starts and in the help text. */
  description: string;
  /**
   * Reads one message. Never throws.
   * @param awaiting the unfinished request, when the assistant has asked the user a question about it
   */
  read(text: string, awaiting?: ParsedMessage): Promise<Reading>;
}

export function createRuleReader(known: KnownNames): MessageReader {
  return {
    description: "Messages are read by built-in rules. The LLM is not configured (OPENAI_API_KEY is not set).",
    // The rules read each message by itself; the Agent joins an answer to its question.
    read: async (text) => ({ parsed: parseMessage(text, known) }),
  };
}

export interface MessageReaderOptions {
  known: KnownNames;
  /** The value of OPENAI_API_KEY. Missing or empty means: use the rules. */
  apiKey: string | undefined;
  llm: LlmSettings;
}

/** Picks the reader once, when the app starts. */
export function createMessageReader(options: MessageReaderOptions): MessageReader {
  const apiKey = (options.apiKey ?? "").trim();
  if (apiKey === "") {
    return createRuleReader(options.known);
  }
  return createOpenAiReader({
    known: options.known,
    model: options.llm.model,
    retryAfterSeconds: options.llm.retryAfterSeconds,
    askModel: createOpenAiModel({ apiKey, model: options.llm.model, timeoutMs: options.llm.requestTimeoutMs }),
  });
}
