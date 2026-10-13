import { parseMessage } from "@/agent/intentParser.ts";
import { createOpenAiModel } from "@/agent/openAiModel.ts";
import { createOpenAiReader } from "@/agent/openAiReader.ts";
import { RULES_DESCRIPTION } from "@/constants/agent.ts";
import type { KnownNames, MessageReader, MessageReaderOptions } from "@/types/agent.ts";

export function createRuleReader(known: KnownNames): MessageReader {
  return {
    description: RULES_DESCRIPTION,
    // The rules read each message by itself; the Agent joins an answer to its question.
    read: async (text) => ({ parsed: parseMessage(text, known) }),
  };
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
