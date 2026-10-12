// One session per browser tab, kept in memory. A session holds the conversation and
// what the agent needs to remember between messages: what "it" refers to, a question
// it is waiting to have answered, and a change waiting for Confirm.

import type { ChangePlan } from "../services/deploymentService.ts";
import type { ParsedMessage } from "./intentParser.ts";

export interface ChatMessage {
  role: "user" | "agent";
  text: string;
  at: Date;
  /** Set on an agent message that asks for confirmation. */
  action?: { id: string; warning: string | null };
  /** Set on an agent message about a change that was started; progress is read by this ID. */
  operationId?: string;
}

export interface PendingAction {
  id: string;
  plan: ChangePlan;
  createdAtMs: number;
}

export interface Session {
  id: string;
  messages: ChatMessage[];
  /** The app and environment last talked about, so "is it healthy?" knows what "it" is. */
  app?: string;
  environment?: string;
  /** The last question asked, so "what about prod?" can repeat it for prod. */
  lastQuestion?: ParsedMessage;
  /** A request that still misses a detail the agent has asked for. */
  awaiting?: ParsedMessage;
  /** A change that waits for Confirm or Cancel. At most one at a time. */
  pending?: PendingAction;
}

const MAX_SESSIONS = 500;
const MAX_MESSAGES = 200;

export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  /** Returns the session with this ID, creating it on first use. */
  get(id: string): Session {
    let session = this.sessions.get(id);
    if (session === undefined) {
      session = { id, messages: [] };
      this.sessions.set(id, session);
      // Forget the oldest sessions so memory cannot grow without limit.
      while (this.sessions.size > MAX_SESSIONS) {
        const oldest = this.sessions.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        this.sessions.delete(oldest);
      }
    }
    return session;
  }

  addMessage(session: Session, message: ChatMessage): void {
    session.messages.push(message);
    if (session.messages.length > MAX_MESSAGES) {
      session.messages.splice(0, session.messages.length - MAX_MESSAGES);
    }
  }
}
