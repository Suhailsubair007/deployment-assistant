import { API } from "@/lib/constants.ts";
import { callApi } from "@/lib/http.ts";
import { readIdentity } from "@/lib/identity.ts";
import type { AgentReply, EnvironmentSummary, Operation, StoredMessage } from "@/lib/types.ts";

/** A typed message. */
export function sendMessage(message: string) {
  return callApi<{ reply: AgentReply }>("POST", API.chat, readIdentity(), { message });
}

/** The Confirm or the Cancel button. */
export function decideAction(actionId: string, choice: "confirm" | "cancel") {
  const path = `${API.actions}/${encodeURIComponent(actionId)}/${choice}`;
  return callApi<{ reply: AgentReply }>("POST", path, readIdentity());
}

/** Progress of a running change. */
export function getOperation(operationId: string) {
  const path = `${API.operations}/${encodeURIComponent(operationId)}`;
  return callApi<{ operation: Operation }>("GET", path, readIdentity());
}

/** The status panel. */
export function getStatus() {
  return callApi<{ cluster: string; environments: EnvironmentSummary[]; checkedAt: string }>(
    "GET",
    API.status,
    readIdentity(),
  );
}

/** The conversation of this tab, so a page reload does not lose it. */
export function getSession() {
  return callApi<{ messages: StoredMessage[]; pendingActionId: string | null }>("GET", API.session, readIdentity());
}
