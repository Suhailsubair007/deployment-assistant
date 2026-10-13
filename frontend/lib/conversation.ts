import type { ActionRequest, AgentReply, ChatItem, StoredMessage } from "@/lib/types.ts";

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
