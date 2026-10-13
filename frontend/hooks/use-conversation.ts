"use client";

import { useEffect, useState } from "react";

import { decideAction, getSession, sendMessage } from "@/lib/api";
import { addReply, closeAction, fromStoredMessages } from "@/lib/conversation";
import { messageOf } from "@/lib/http";
import type { AgentReply, ChatItem } from "@/lib/types";

function now(): string {
  return new Date().toISOString();
}

function errorItem(error: unknown): ChatItem {
  return { role: "agent", text: messageOf(error), at: now(), isError: true };
}

/** This tab's conversation: its messages, and the two ways the user adds to it. */
export function useConversation() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSending, setIsSending] = useState(false);
  // How many requests are waiting for an answer. "Working on it" shows while it is above zero.
  const [waiting, setWaiting] = useState(0);

  // Draws this tab's conversation again after a page reload.
  useEffect(() => {
    let cancelled = false;
    getSession()
      .then(({ messages, pendingActionId }) => {
        if (!cancelled) {
          setItems(fromStoredMessages(messages, pendingActionId));
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setItems([errorItem(error)]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Makes one request and adds the answer, or the error sentence, to the conversation. */
  async function ask(request: () => Promise<{ reply: AgentReply }>): Promise<void> {
    setWaiting((count) => count + 1);
    try {
      const { reply } = await request();
      const at = now();
      setItems((current) => addReply(current, reply, at));
    } catch (error) {
      const item = errorItem(error);
      setItems((current) => [...current, item]);
    } finally {
      setWaiting((count) => count - 1);
    }
  }

  async function send(text: string): Promise<void> {
    const item: ChatItem = { role: "user", text, at: now() };
    setItems((current) => [...current, item]);
    setIsSending(true);
    await ask(() => sendMessage(text));
    setIsSending(false);
  }

  async function decide(actionId: string, choice: "confirm" | "cancel"): Promise<void> {
    const note = choice === "confirm" ? "You confirmed" : "You cancelled";
    const item: ChatItem = { role: "user", text: choice === "confirm" ? "(clicked Confirm)" : "(clicked Cancel)", at: now() };
    // The buttons are switched off at once, so a double click cannot send the choice twice.
    setItems((current) => [...closeAction(current, actionId, note), item]);
    await ask(() => decideAction(actionId, choice));
  }

  return { items, isLoaded, isSending, isWorking: waiting > 0, send, decide };
}
