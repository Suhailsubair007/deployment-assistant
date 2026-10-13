import { SESSION_ID_KEY, USER_NAME_KEY } from "@/lib/constants.ts";
import type { Identity } from "@/lib/types.ts";

/** sessionStorage belongs to one tab, so every tab gets its own conversation. */
function sessionId(): string {
  let id = sessionStorage.getItem(SESSION_ID_KEY);
  if (id === null) {
    id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_ID_KEY, id);
  }
  return id;
}

/** The name is the same in every tab; it is stored as "requested by" in the history. */
export function readUserName(): string {
  return localStorage.getItem(USER_NAME_KEY) ?? "";
}

export function saveUserName(name: string): void {
  localStorage.setItem(USER_NAME_KEY, name.trim());
}

export function readIdentity(): Identity {
  return { sessionId: sessionId(), userName: readUserName() };
}
