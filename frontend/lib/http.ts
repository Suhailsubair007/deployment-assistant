// One function for every call to our web API. The page knows nothing about Kubernetes;
// it only talks to the API through here.

/** Who is asking: the tab's conversation and the name stored as "requested by". */
export interface Identity {
  sessionId: string;
  userName: string;
}

/** Calls our API. Returns the JSON body, or throws an Error with the server's own sentence. */
export async function callApi<T>(method: "GET" | "POST", path: string, identity: Identity, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Session-Id": identity.sessionId,
        "X-User-Name": identity.userName,
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
