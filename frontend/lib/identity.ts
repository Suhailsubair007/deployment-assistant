// Who is talking. Both values live in the browser's storage, so these functions are
// called only from event handlers and effects, never while the page is built.

import type { Identity } from "./http.ts";

/** sessionStorage belongs to one tab, so every tab gets its own conversation. */
function sessionId(): string {
  let id = sessionStorage.getItem("sessionId");
  if (id === null) {
    id = crypto.randomUUID();
    sessionStorage.setItem("sessionId", id);
  }
  return id;
}

/** The name is the same in every tab; it is stored as "requested by" in the history. */
export function readUserName(): string {
  return localStorage.getItem("userName") ?? "";
}

export function saveUserName(name: string): void {
  localStorage.setItem("userName", name.trim());
}

export function readIdentity(): Identity {
  return { sessionId: sessionId(), userName: readUserName() };
}
