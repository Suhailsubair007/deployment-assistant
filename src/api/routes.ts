import express from "express";
import type { ErrorRequestHandler, Express, Request } from "express";

import { toUserError } from "@/api/errorMapper.ts";
import {
  ALLOWED_HOSTS,
  ANONYMOUS_USER,
  JSON_BODY_LIMIT,
  MAX_MESSAGE_LENGTH,
  MAX_USER_NAME_LENGTH,
  SESSION_HEADER,
  SESSION_ID_PATTERN,
  USER_HEADER,
} from "@/constants/api.ts";
import { InvalidRequestError, NotFoundError } from "@/errors.ts";
import type { AppDeps } from "@/types/api.ts";

/** Every tab sends its own ID in the X-Session-Id header. */
function sessionIdOf(request: Request): string {
  const id = request.get(SESSION_HEADER) ?? "";
  if (!SESSION_ID_PATTERN.test(id)) {
    throw new InvalidRequestError(`The ${SESSION_HEADER} header is missing or not valid.`);
  }
  return id;
}

/** The name recorded as "requested by" in the history. */
function userNameOf(request: Request): string {
  const name = (request.get(USER_HEADER) ?? "").trim().slice(0, MAX_USER_NAME_LENGTH);
  return name === "" ? ANONYMOUS_USER : name;
}

export function createApp(deps: AppDeps): Express {
  const { agent, operations, statuses, sessions } = deps;
  const app = express();

  // The page is only ever opened as 127.0.0.1 or localhost. A request that names another
  // host comes from a web page elsewhere that pointed its own name at this machine. The
  // assistant can build and deploy, so such a request is refused before anything is read.
  app.use((request, _response, next) => {
    const host = (request.get("host") ?? "").replace(/:\d+$/, "");
    if (!ALLOWED_HOSTS.has(host)) {
      throw new InvalidRequestError(
        "This address is not one the assistant answers to. Open it as http://127.0.0.1 or http://localhost.",
      );
    }
    next();
  });

  app.use(express.json({ limit: JSON_BODY_LIMIT }));

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
    response.json({
      cluster: statuses.clusterName(),
      environments: await statuses.getSummaries(),
      checkedAt: new Date(),
    });
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
