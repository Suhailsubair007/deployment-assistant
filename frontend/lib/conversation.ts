// The messages of one conversation and the three ways the list changes. These are plain
// functions that return a new list, so they can be tested without a browser.

import type { ActionRequest, AgentReply, StoredMessage } from "./types.ts";

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
}

function isOpen(item: ChatItem): boolean {
  return item.action !== undefined && item.actionNote === undefined;
}

/** The conversation as the server stored it, drawn again after a page reload. */
export function fromStoredMessages(messages: StoredMessage[], pendingActionId: string | null): ChatItem[] {
  // An action that was already used keeps its buttons, switched off.
  return messages.map((message) =>
    message.action !== undefined && message.action.id !== pendingActionId
      ? { ...message, actionNote: "No longer active" }
      : message,
  );
}

/** Adds an agent reply to the end. */
export function addReply(items: ChatItem[], reply: AgentReply, at: string): ChatItem[] {
  // The server keeps one pending change per tab. A new one replaces any older one,
  // so the older Confirm and Cancel buttons are switched off.
  const earlier =
    reply.action === undefined
      ? items
      : items.map((item) => (isOpen(item) ? { ...item, actionNote: "Replaced by a newer request" } : item));
  return [...earlier, { role: "agent", ...reply, at }];
}

/** Switches Confirm and Cancel of one action off and notes why. An action that is off already keeps its note. */
export function closeAction(items: ChatItem[], actionId: string, note: string): ChatItem[] {
  return items.map((item) => (item.action?.id === actionId && isOpen(item) ? { ...item, actionNote: note } : item));
}
