import { MAX_MESSAGES, MAX_SESSIONS } from "@/constants/agent.ts";
import type { ChatMessage, Session } from "@/types/agent.ts";

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
