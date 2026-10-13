// The agent: has each chat message read, works out what is wanted, asks when something
// is missing, and answers. It never touches the cluster itself; it calls the services.
//
// Reading a message is done by a MessageReader: the built-in rules, or OpenAI when an
// API key is set. Whichever reads it, everything after that is the same code.
//
// Safety rule: a message can only ever create a *pending* change. The change is
// carried out by confirm(), which the web layer calls when the Confirm button is clicked.

import { randomUUID } from "node:crypto";

import type { AppConfig } from "../config.ts";
import { AppError, InvalidRequestError } from "../errors.ts";
import type { ChangePlan, DeploymentService } from "../services/deploymentService.ts";
import { formatDeploymentId } from "../services/historyStore.ts";
import type { HistoryFilter, HistoryStore } from "../services/historyStore.ts";
import type { StatusService } from "../services/statusService.ts";
import type { KnownNames, ParsedMessage } from "./intentParser.ts";
import { createRuleReader } from "./messageReader.ts";
import type { MessageReader } from "./messageReader.ts";
import {
  formatFullStatus,
  formatHealth,
  formatHelp,
  formatHistory,
  formatNodes,
  formatPlan,
  formatProtectedWarning,
  formatTopPod,
  formatUsage,
} from "./replyFormatter.ts";
import type { Session, SessionStore } from "./sessionStore.ts";

export interface AgentReply {
  text: string;
  /** Set when the reply asks for confirmation: the browser shows Confirm and Cancel. */
  action?: { id: string; warning: string | null };
  /** Set when a change has started: the browser follows its progress by this ID. */
  operationId?: string;
}

export interface AgentDeps {
  config: AppConfig;
  deployments: DeploymentService;
  statuses: StatusService;
  history: HistoryStore;
  sessions: SessionStore;
  /** How messages are read. Left out, the built-in rules read them. */
  reader?: MessageReader;
  /** The current time in milliseconds. Tests replace this. */
  now?: () => number;
}

const CONFIRMATION_LIFETIME_MS = 10 * 60 * 1000;
const DEFAULT_HISTORY_ROWS = 5;
const MAX_HISTORY_ROWS = 50;

const STARTED: Record<ChangePlan["action"], string> = {
  deploy: "Rolling update started",
  rollback: "Rollback started",
  scale: "Scaling started",
};

export class Agent {
  private readonly config: AppConfig;
  private readonly deployments: DeploymentService;
  private readonly statuses: StatusService;
  private readonly history: HistoryStore;
  private readonly sessions: SessionStore;
  private readonly reader: MessageReader;
  private readonly now: () => number;
  private readonly known: KnownNames;

  constructor(deps: AgentDeps) {
    this.config = deps.config;
    this.deployments = deps.deployments;
    this.statuses = deps.statuses;
    this.history = deps.history;
    this.sessions = deps.sessions;
    this.now = deps.now ?? Date.now;
    this.known = { environments: Object.keys(deps.config.environments), apps: Object.keys(deps.config.apps) };
    this.reader = deps.reader ?? createRuleReader(this.known);
  }

  // ---- Entry points, called by the web layer ----

  /** Answers one chat message. Problems the user can act on come back as a normal reply. */
  async handleMessage(sessionId: string, text: string, user: string): Promise<AgentReply> {
    const session = this.sessions.get(sessionId);
    this.sessions.addMessage(session, { role: "user", text, at: new Date(this.now()) });
    // The reader is told about an open question, so it can read "the staging one" as its answer.
    const reading = await this.reader.read(text, session.awaiting);
    const reply = await this.asReply(() => this.respond(session, reading.parsed, text, user));
    if (reading.fallbackNote !== undefined) {
      // The rules read this message because OpenAI could not. Say so, since the rules
      // understand fewer phrasings and the user should know why.
      reply.text += `\nNote: ${reading.fallbackNote}`;
    }
    this.record(session, reply);
    return reply;
  }

  /** Carries out the pending change. Called when the user clicks Confirm. */
  async confirm(sessionId: string, actionId: string, user: string): Promise<AgentReply> {
    const session = this.sessions.get(sessionId);
    this.sessions.addMessage(session, { role: "user", text: "(clicked Confirm)", at: new Date(this.now()) });

    const reply = await this.asReply(async () => {
      const pending = session.pending;
      // The action must be the one waiting in *this* session. Another tab's ID does not match.
      if (pending === undefined || pending.id !== actionId) {
        throw new InvalidRequestError("That confirmation is no longer valid. Please ask again.");
      }
      // A confirmation works once, whatever happens next.
      session.pending = undefined;
      if (this.now() - pending.createdAtMs > CONFIRMATION_LIFETIME_MS) {
        throw new InvalidRequestError("That confirmation has expired. Please ask again.");
      }
      const { operation } = await this.deployments.execute(pending.plan, user);
      return {
        text: `${STARTED[pending.plan.action]} (${formatDeploymentId(operation.deploymentId)}).`,
        operationId: operation.id,
      };
    });
    this.record(session, reply);
    return reply;
  }

  /** Drops the pending change. Called when the user clicks Cancel. */
  cancel(sessionId: string, actionId: string): AgentReply {
    const session = this.sessions.get(sessionId);
    this.sessions.addMessage(session, { role: "user", text: "(clicked Cancel)", at: new Date(this.now()) });

    let reply: AgentReply;
    if (session.pending?.id === actionId) {
      session.pending = undefined;
      reply = { text: "Cancelled. Nothing was changed." };
    } else {
      reply = { text: "That confirmation is no longer valid. Please ask again." };
    }
    this.record(session, reply);
    return reply;
  }

  // ---- Working out the answer ----

  private async respond(session: Session, parsed: ParsedMessage, text: string, user: string): Promise<AgentReply> {
    const request = this.combine(session, parsed, text);
    if (request === null || request.intent === null) {
      return { text: `I didn't understand that.\n${formatHelp(this.known, this.reader.description)}` };
    }

    if (request.unknownEnvironment !== undefined && request.environment === undefined) {
      // Keep the rest of the request, so the user only has to name a real environment.
      const { unknownEnvironment, ...rest } = request;
      session.awaiting = rest;
      return {
        text: `There is no environment called "${unknownEnvironment}". I know: ${this.known.environments.join(", ")}. Which one do you mean?`,
      };
    }

    const app = request.app ?? session.app ?? (this.known.apps.length === 1 ? this.known.apps[0] : undefined);
    if (app === undefined) {
      return this.ask(session, request, `Which app: ${this.oneOf(this.known.apps)}?`);
    }
    const environments = this.oneOf(this.known.environments);

    switch (request.intent) {
      case "help":
        return { text: formatHelp(this.known, this.reader.description) };

      case "nodes":
        session.awaiting = undefined;
        return { text: formatNodes(await this.statuses.getNodes()) };

      case "history": {
        session.awaiting = undefined;
        const limit = Math.min(Math.max(request.limit ?? DEFAULT_HISTORY_ROWS, 1), MAX_HISTORY_ROWS);
        const filter: HistoryFilter = { limit };
        if (request.mine) {
          filter.requestedBy = user;
        }
        if (request.environment !== undefined) {
          filter.environment = request.environment;
        }
        return { text: formatHistory(this.history.list(filter), filter) };
      }

      // Changes. The environment must be named in this request: the agent never
      // borrows it from earlier messages, because a wrong guess would change the wrong place.
      case "deploy": {
        const { version, environment } = request;
        const pieces = { ...request, app };
        if (version === undefined && environment === undefined) {
          return this.ask(session, pieces, `Which version of ${app} should I deploy, and to which environment (${environments})?`);
        }
        if (version === undefined) {
          return this.ask(session, pieces, `Which version of ${app} should I deploy to ${environment}? For example: v2`);
        }
        if (environment === undefined) {
          return this.ask(session, pieces, `Deploy ${app} version ${version} to which environment: ${environments}?`);
        }
        session.awaiting = undefined;
        return this.offer(session, await this.deployments.planDeploy({ environment, app, version }));
      }

      case "scale": {
        const { replicas, environment } = request;
        const pieces = { ...request, app };
        if (environment === undefined) {
          return this.ask(session, pieces, `Scale ${app} in which environment: ${environments}?`);
        }
        if (replicas === undefined) {
          return this.ask(session, pieces, `How many replicas should ${app} have in ${environment}?`);
        }
        session.awaiting = undefined;
        return this.offer(session, await this.deployments.planScale({ environment, app, replicas }));
      }

      case "rollback": {
        const { environment } = request;
        if (environment === undefined) {
          return this.ask(session, { ...request, app }, `Roll back ${app} in which environment: ${environments}?`);
        }
        session.awaiting = undefined;
        return this.offer(session, await this.deployments.planRollback({ environment, app }));
      }

      // Questions. These may use the environment the conversation is already about.
      case "health":
      case "status":
      case "usage": {
        const environment = request.environment ?? session.environment;
        if (environment === undefined) {
          return this.ask(session, { ...request, app }, `Which environment: ${environments}?`);
        }
        session.awaiting = undefined;
        session.app = app;
        session.environment = environment;
        session.lastQuestion = { ...request, app, environment };
        return { text: await this.answerQuestion(request, environment, app) };
      }
    }
  }

  private async answerQuestion(request: ParsedMessage, environment: string, app: string): Promise<string> {
    const notDeployed = `${app} is not deployed in ${environment} yet. To deploy it, type: deploy ${app} version v1 to ${environment}`;

    if (request.intent === "usage") {
      const usage = await this.statuses.getUsage(environment, app);
      if (usage === null) {
        return notDeployed;
      }
      return request.topPodBy === undefined
        ? formatUsage(environment, app, usage)
        : formatTopPod(usage, request.topPodBy);
    }

    const status = await this.statuses.getStatus(environment, app);
    if (status === null) {
      return notDeployed;
    }
    return request.intent === "status" ? formatFullStatus(status) : formatHealth(status);
  }

  /**
   * Joins a message with what came before it.
   *  - A message that names an action stands on its own.
   *  - Otherwise it may answer a question the agent asked ("staging", "v2", "5"),
   *  - or follow up on the last question ("what about prod?").
   * Returns null when it is none of these.
   */
  private combine(session: Session, parsed: ParsedMessage, text: string): ParsedMessage | null {
    if (parsed.intent !== null) {
      return parsed;
    }
    const { intent: _none, ...details } = parsed;
    const hasDetails = Object.keys(details).length > 0;

    const awaiting = session.awaiting;
    if (awaiting !== undefined) {
      const merged: ParsedMessage = { ...awaiting, ...details };
      const answer = text.trim();
      const oneWord = /^[\w.-]+$/.test(answer);

      if (awaiting.intent === "deploy" && merged.version === undefined && oneWord && details.environment === undefined) {
        // A bare word answering "which version?". If the environment is also still
        // open, only take it as a version when it looks like one (it has a digit).
        if (merged.environment !== undefined || /\d/.test(answer)) {
          merged.version = answer;
          return merged;
        }
      }
      if (!hasDetails && oneWord && merged.environment === undefined) {
        // A bare word answering "which environment?" that is not one we know.
        merged.unknownEnvironment = answer.toLowerCase();
        return merged;
      }
      if (hasDetails) {
        return merged;
      }
      // Something unrelated: forget the open question.
      session.awaiting = undefined;
      return null;
    }

    const lastQuestion = session.lastQuestion;
    if (lastQuestion !== undefined && (details.environment !== undefined || details.unknownEnvironment !== undefined || details.app !== undefined)) {
      if (details.unknownEnvironment !== undefined) {
        // "what about qa?": the earlier environment must not answer for one that does not exist.
        const { environment: _earlier, ...question } = lastQuestion;
        return { ...question, ...details };
      }
      return { ...lastQuestion, ...details };
    }
    return null;
  }

  // ---- Small helpers ----

  /** Remembers the request and asks for the missing detail. */
  private ask(session: Session, request: ParsedMessage, question: string): AgentReply {
    session.awaiting = request;
    return { text: question };
  }

  /** Stores the plan as the session's pending change and returns the summary to confirm. */
  private offer(session: Session, plan: ChangePlan): AgentReply {
    const id = randomUUID();
    session.pending = { id, plan, createdAtMs: this.now() };
    session.app = plan.app;
    session.environment = plan.environment;
    const warning = this.config.environments[plan.environment].protected
      ? formatProtectedWarning(plan.environment)
      : null;
    return { text: formatPlan(plan), action: { id, warning } };
  }

  /** "staging or prod", "a, b or c". */
  private oneOf(names: string[]): string {
    if (names.length <= 1) {
      return names.join("");
    }
    return `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
  }

  /** Runs a step; an error meant for the user becomes the reply. Other errors are bugs and are thrown on. */
  private async asReply(step: () => Promise<AgentReply>): Promise<AgentReply> {
    try {
      return await step();
    } catch (error) {
      if (error instanceof AppError) {
        return { text: error.message };
      }
      throw error;
    }
  }

  private record(session: Session, reply: AgentReply): void {
    this.sessions.addMessage(session, { role: "agent", at: new Date(this.now()), ...reply });
  }
}
