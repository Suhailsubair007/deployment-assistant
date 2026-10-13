// The web API. Each handler reads the request, calls the agent or a service, and
// returns JSON. There is no logic here and no Kubernetes call: that is the rule that
// keeps this layer thin.

import express from "express";
import type { ErrorRequestHandler, Express, Request } from "express";

import type { Agent } from "../agent/agent.ts";
import type { SessionStore } from "../agent/sessionStore.ts";
import { InvalidRequestError, NotFoundError } from "../errors.ts";
import type { OperationStore } from "../services/operationStore.ts";
import type { StatusService } from "../services/statusService.ts";
import { toUserError } from "./errorMapper.ts";
import type { ErrorLogger } from "./errorMapper.ts";

export interface AppDeps {
  agent: Agent;
  operations: OperationStore;
  statuses: StatusService;
  sessions: SessionStore;
  /** Folder with the built page (frontend/out). Left out in tests. */
  staticFolder?: string;
  /** Where unexpected errors are logged. Tests silence it. */
  logError?: ErrorLogger;
}

const MAX_MESSAGE_LENGTH = 500;
const SESSION_ID = /^[\w-]{8,64}$/;

/**
 * Every tab sends its own ID in the X-Session-Id header.
 * Requiring a custom header also means another website cannot make the browser send
 * a request here without the user knowing: browsers block that for custom headers.
 */
function sessionIdOf(request: Request): string {
  const id = request.get("X-Session-Id") ?? "";
  if (!SESSION_ID.test(id)) {
    throw new InvalidRequestError("The X-Session-Id header is missing or not valid.");
  }
  return id;
}

/** The name recorded as "requested by" in the history. */
function userNameOf(request: Request): string {
  const name = (request.get("X-User-Name") ?? "").trim().slice(0, 40);
  return name === "" ? "anonymous" : name;
}

export function createApp(deps: AppDeps): Express {
  const { agent, operations, statuses, sessions } = deps;
  const app = express();
  app.use(express.json({ limit: "10kb" }));

  // A typed message.
  app.post("/api/chat", async (request, response) => {
    const sessionId = sessionIdOf(request);
    const message: unknown = (request.body as { message?: unknown } | undefined)?.message;
    if (typeof message !== "string" || message.trim() === "" || message.length > MAX_MESSAGE_LENGTH) {
      throw new InvalidRequestError(`Type a message of at most ${MAX_MESSAGE_LENGTH} characters.`);
    }
    response.json({ reply: await agent.handleMessage(sessionId, message.trim(), userNameOf(request)) });
  });

  // The Confirm button.
  app.post("/api/actions/:id/confirm", async (request, response) => {
    response.json({ reply: await agent.confirm(sessionIdOf(request), request.params.id, userNameOf(request)) });
  });

  // The Cancel button.
  app.post("/api/actions/:id/cancel", (request, response) => {
    response.json({ reply: agent.cancel(sessionIdOf(request), request.params.id) });
  });

  // Progress of a running change. The browser asks every second.
  app.get("/api/operations/:id", (request, response) => {
    const operation = operations.get(request.params.id);
    if (operation === null) {
      throw new NotFoundError("That operation is not known. It may be too old.", "operations");
    }
    response.json({ operation });
  });

  // The status panel.
  app.get("/api/status", async (_request, response) => {
    response.json({ environments: await statuses.getSummaries(), checkedAt: new Date() });
  });

  // The conversation of this tab, so a page reload does not lose it.
  app.get("/api/session", (request, response) => {
    const session = sessions.get(sessionIdOf(request));
    response.json({ messages: session.messages, pendingActionId: session.pending?.id ?? null });
  });

  if (deps.staticFolder !== undefined) {
    app.use(express.static(deps.staticFolder));
  }

  // Every error thrown above ends up here and leaves as one clear sentence.
  const handleError: ErrorRequestHandler = (error, _request, response, _next) => {
    const { status, message } = toUserError(error, deps.logError);
    response.status(status).json({ error: message });
  };
  app.use(handleError);

  return app;
}
