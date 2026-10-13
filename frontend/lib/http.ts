import { SESSION_HEADER, USER_HEADER } from "@/lib/constants.ts";
import type { Identity } from "@/lib/types.ts";

/** Calls our API. Returns the JSON body, or throws an Error with the server's own sentence. */
export async function callApi<T>(method: "GET" | "POST", path: string, identity: Identity, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        [SESSION_HEADER]: identity.sessionId,
        [USER_HEADER]: identity.userName,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("The Deployment Assistant server is not answering. Is it still running?");
  }
  // An error answer that is not JSON (for example from a proxy) still gets a clear sentence below.
  const data: { error?: string } = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error ?? `The server answered with status ${response.status}.`);
  }
  return data as T;
}

/** The sentence to show for something that was caught. callApi always throws an Error. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
