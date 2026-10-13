import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError } from "openai";

import { ANSWER_NOT_USABLE } from "@/constants/llm.ts";
import { ModelUnavailableError } from "@/errors.ts";
import type { AskModel, OpenAiModelSettings } from "@/types/llm.ts";

/** Why a call failed: a sentence for the user, and a short technical note for the server log. */
function describeFailure(error: unknown, settings: OpenAiModelSettings): ModelUnavailableError {
  if (error instanceof APIConnectionTimeoutError) {
    return new ModelUnavailableError(`OpenAI did not answer within ${settings.timeoutMs / 1000} seconds.`, error.message);
  }
  if (error instanceof APIConnectionError) {
    return new ModelUnavailableError("I could not reach OpenAI.", error.message);
  }
  if (!(error instanceof APIError) || error.status === undefined) {
    return new ModelUnavailableError("OpenAI refused the request.", error instanceof Error ? error.message : String(error));
  }

  const code = `HTTP ${error.status}${error.code ? `, ${error.code}` : ""}`;
  if (error.status === 401) {
    // OpenAI's own explanation is left out of the log here: it repeats part of the key.
    return new ModelUnavailableError("OpenAI rejected the API key.", code);
  }
  // For everything else the explanation is what is needed to fix the problem.
  const detail = `${code}: ${error.message}`;
  if (error.status === 403) {
    return new ModelUnavailableError(`This OpenAI API key is not allowed to use the model "${settings.model}".`, detail);
  }
  if (error.status === 404) {
    return new ModelUnavailableError(
      `OpenAI does not know the model "${settings.model}". Check llm.model in the config file.`,
      detail,
    );
  }
  if (error.status === 429) {
    return new ModelUnavailableError(
      "OpenAI is refusing requests right now (rate limit reached or no credit left).",
      detail,
    );
  }
  if (error.status >= 500) {
    return new ModelUnavailableError("OpenAI had a problem on its side.", detail);
  }
  return new ModelUnavailableError("OpenAI refused the request.", detail);
}

export function createOpenAiModel(settings: OpenAiModelSettings): AskModel {
  const client = new OpenAI({
    apiKey: settings.apiKey,
    timeout: settings.timeoutMs,
    // One try only. When OpenAI does not answer, the built-in rules are the retry.
    maxRetries: 0,
    fetch: settings.fetch,
  });

  return async ({ instructions, message, tools }) => {
    let completion;
    try {
      completion = await client.chat.completions.create({
        model: settings.model,
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: message },
        ],
        // "strict" makes OpenAI keep to each tool's list of details.
        tools: tools.map((tool) => ({ type: "function" as const, function: { ...tool, strict: true } })),
        // The model must pick a tool; it may not answer in free text.
        tool_choice: "required",
      });
    } catch (error) {
      throw describeFailure(error, settings);
    }

    // One message is one action: only the first picked tool counts.
    const call = completion.choices[0]?.message.tool_calls?.[0];
    if (call === undefined || call.type !== "function") {
      throw new ModelUnavailableError(ANSWER_NOT_USABLE, "no tool was picked");
    }
    try {
      return { name: call.function.name, args: JSON.parse(call.function.arguments) as unknown };
    } catch {
      throw new ModelUnavailableError(ANSWER_NOT_USABLE, "the tool's details were not valid JSON");
    }
  };
}
