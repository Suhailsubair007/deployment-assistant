// The six calls the page makes, one function per route of the web API.

import { callApi } from "./http.ts";
import { readIdentity } from "./identity.ts";
import type { AgentReply, EnvironmentSummary, Operation, StoredMessage } from "./types.ts";

/** A typed message. */
export function sendMessage(message: string) {
  return callApi<{ reply: AgentReply }>("POST", "/api/chat", readIdentity(), { message });
}

/** The Confirm or the Cancel button. */
export function decideAction(actionId: string, choice: "confirm" | "cancel") {
  return callApi<{ reply: AgentReply }>(
    "POST",
    `/api/actions/${encodeURIComponent(actionId)}/${choice}`,
    readIdentity(),
  );
}

/** Progress of a running change. */
export function getOperation(operationId: string) {
  return callApi<{ operation: Operation }>(
    "GET",
    `/api/operations/${encodeURIComponent(operationId)}`,
    readIdentity(),
  );
}

/** The status panel. */
export function getStatus() {
  return callApi<{ environments: EnvironmentSummary[]; checkedAt: string }>("GET", "/api/status", readIdentity());
}

/** The conversation of this tab, so a page reload does not lose it. */
export function getSession() {
  return callApi<{ messages: StoredMessage[]; pendingActionId: string | null }>(
    "GET",
    "/api/session",
    readIdentity(),
  );
}
