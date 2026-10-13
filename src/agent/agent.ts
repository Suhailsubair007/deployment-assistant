import { randomUUID } from "node:crypto";

import { parseMessage } from "@/agent/intentParser.ts";
import { liveNames } from "@/agent/knownNames.ts";
import { createRuleReader } from "@/agent/messageReader.ts";
import {
  formatFullStatus,
  formatHealth,
  formatHelp,
  formatHistory,
  formatNodes,
  formatPlan,
  formatProtectedWarning,
  formatSuggestions,
  formatTopPod,
  formatUsage,
} from "@/agent/replyFormatter.ts";
import { createServiceFlow } from "@/agent/serviceFlow.ts";
import { startCreate, startEdit } from "@/agent/serviceWizard.ts";
import type { SessionStore } from "@/agent/sessionStore.ts";
import {
  BUILD_STARTED,
  CANCELLED,
  CONFIRMATION_EXPIRED,
  CONFIRMATION_INVALID,
  CONFIRMATION_LIFETIME_MS,
  DEFAULT_HISTORY_ROWS,
  MAX_HISTORY_ROWS,
  NOT_UNDERSTOOD,
  STARTED_MESSAGES,
  WIZARD_BUSY,
} from "@/constants/agent.ts";
import { AppError, InvalidRequestError } from "@/errors.ts";
import type { DeploymentService } from "@/services/deploymentService.ts";
import { formatDeploymentId } from "@/services/historyStore.ts";
import type { HistoryStore } from "@/services/historyStore.ts";
import type { ServiceRegistry } from "@/services/serviceRegistry.ts";
import type { StatusService } from "@/services/statusService.ts";
import type {
  AgentDeps,
  AgentReply,
  KnownNames,
  MessageReader,
  OpenQuestions,
  ParsedMessage,
  Session,
} from "@/types/agent.ts";
import type { AppConfig } from "@/types/config.ts";
import type { ChangePlan, HistoryFilter } from "@/types/deployment.ts";
import type { ServiceFlow, WizardContext, WizardStep } from "@/types/wizard.ts";

export class Agent {
  private readonly config: AppConfig;
  private readonly deployments: DeploymentService;
  private readonly statuses: StatusService;
  private readonly history: HistoryStore;
  private readonly sessions: SessionStore;
  private readonly registry: ServiceRegistry;
  private readonly reader: MessageReader;
  private readonly questions: ServiceFlow;
  private readonly now: () => number;
  private readonly known: KnownNames;

  constructor(deps: AgentDeps) {
    this.config = deps.config;
    this.deployments = deps.deployments;
    this.statuses = deps.statuses;
    this.history = deps.history;
    this.sessions = deps.sessions;
    this.registry = deps.registry;
    this.now = deps.now ?? Date.now;
    this.known = liveNames(deps.config, deps.registry);
    this.reader = deps.reader ?? createRuleReader(this.known);
    this.questions = deps.questions ?? createServiceFlow({ context: () => this.wizardContext() });
  }

  // ---- Entry points, called by the web layer ----

  /** Answers one chat message. Problems the user can act on come back as a normal reply. */
  async handleMessage(sessionId: string, text: string, user: string): Promise<AgentReply> {
    const session = this.sessions.get(sessionId);
    this.sessions.addMessage(session, { role: "user", text, at: new Date(this.now()) });

    // While the questions for a service are open, every message is an answer to the
    // current one. It goes to the question flow, where fixed rules check it. It is never
    // handed to the message reader, so a folder path or a variable is not sent to OpenAI.
    if (session.questions !== undefined) {
      const open = session.questions;
      const reply = await this.asReply(() => this.continueQuestions(session, open, text));
      this.record(session, reply);
      return reply;
    }

    // The reader is told about an open question, so it can read "the staging one" as its answer.
    const reading = await this.reader.read(text, session.awaiting);
    const reply = await this.asReply(() => this.respond(session, reading.parsed, text, user));
    if (reading.fallbackNote !== undefined) {
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
        throw new InvalidRequestError(CONFIRMATION_INVALID);
      }
      // A confirmation works once, whatever happens next.
      session.pending = undefined;
      if (this.now() - pending.createdAtMs > CONFIRMATION_LIFETIME_MS) {
        throw new InvalidRequestError(CONFIRMATION_EXPIRED);
      }
      const { operation } = await this.deployments.execute(pending.plan, user);
      const started = pending.plan.buildFrom === undefined ? STARTED_MESSAGES[pending.plan.action] : BUILD_STARTED;
      return {
        text: `${started} (${formatDeploymentId(operation.deploymentId)}).`,
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
      reply = { text: CANCELLED };
    } else {
      reply = { text: CONFIRMATION_INVALID };
    }
    this.record(session, reply);
    return reply;
  }

  // ---- Working out the answer ----

  private async respond(session: Session, parsed: ParsedMessage, text: string, user: string): Promise<AgentReply> {
    const request = this.combine(session, parsed, text);
    if (request === null || request.intent === null) {
      // One sentence and a few requests to click. The full list is the answer to "help".
      return { text: NOT_UNDERSTOOD, suggestions: formatSuggestions(this.known) };
    }

    if (request.unknownEnvironment !== undefined && request.environment === undefined) {
      // Keep the rest of the request, so the user only has to name a real environment.
      const { unknownEnvironment, ...rest } = request;
      session.awaiting = rest;
      return {
        text: `There is no environment called "${unknownEnvironment}". I know: ${this.known.environments.join(", ")}. Which one do you mean?`,
      };
    }

    // These three are not about one app, so they never ask which one.
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

      case "create":
        session.awaiting = undefined;
        // Said now, not after ten answers, when images cannot be built for this cluster.
        this.deployments.assertCanBuild();
        return this.openQuestions(
          session,
          "create",
          startCreate(this.wizardContext(), { environment: request.environment }),
        );
    }

    const apps = this.known.apps;
    const app = request.app ?? session.app ?? (apps.length === 1 ? apps[0] : undefined);
    if (app === undefined) {
      return this.ask(session, request, `Which app: ${this.oneOf(apps)}?`);
    }
    const environments = this.oneOf(this.known.environments);

    switch (request.intent) {
      case "edit": {
        const { environment } = request;
        if (environment === undefined) {
          return this.ask(
            session,
            { ...request, app },
            `Change the settings of ${app} in which environment: ${environments}?`,
          );
        }
        session.awaiting = undefined;
        session.app = app;
        session.environment = environment;
        const { spec } = this.registry.resolve(environment, app);
        return this.openQuestions(session, "edit", startEdit(spec, this.wizardContext()));
      }

      case "deploy": {
        const { version, environment } = request;
        const pieces = { ...request, app };
        // A service built from a folder needs no version: a deploy builds the next one.
        if (version === undefined && this.isBuiltFromFolder(app, environment)) {
          if (environment === undefined) {
            return this.ask(session, pieces, `Build and deploy ${app} to which environment: ${environments}?`);
          }
          session.awaiting = undefined;
          return this.offer(session, await this.deployments.planRebuild({ environment, app }));
        }
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

  // ---- The questions for creating or changing a service (a LangGraph workflow, see serviceFlow.ts) ----

  /** Starts a new conversation in the question flow and gives its first question as the reply. */
  private async openQuestions(session: Session, kind: OpenQuestions["kind"], first: WizardStep): Promise<AgentReply> {
    const thread = randomUUID();
    const step = await this.questions.start(thread, first);
    if (step.kind === "done") {
      // The flow always pauses at a question first; this cannot happen.
      throw new Error("The questions for a service ended before the first one was asked.");
    }
    session.questions = step.kind === "ask" ? { kind, thread } : undefined;
    return { text: step.text };
  }

  /** Hands one answer to the question flow. A bad answer gets the question again; the last one gets the summary to confirm. */
  private async continueQuestions(session: Session, open: OpenQuestions, text: string): Promise<AgentReply> {
    const step = await this.questions.answer(open.thread, text);

    if (step.kind === "ask") {
      // A refused answer of several words that the rules read as a request, for example
      // "deploy sample-app version v2 to staging", is another request and not an answer.
      // It is not carried out: one thing at a time. The questions stay where they are.
      // A single word such as "health" is a wrong answer and gets the usual reason.
      const severalWords = /\s/.test(text.trim());
      if (step.rejected === true && severalWords && parseMessage(text, this.known).intent !== null) {
        return { text: `${WIZARD_BUSY[open.kind]}\n${step.question}` };
      }
      return { text: step.text };
    }

    // The questions are over: cancelled, lost, or every answer is in.
    session.questions = undefined;
    if (step.kind === "cancelled") {
      return { text: step.text };
    }
    const plan =
      open.kind === "create"
        ? await this.deployments.planCreate(step.spec)
        : await this.deployments.planConfigure(step.spec);
    return this.offer(session, plan);
  }

  /** What the questions may know about the world: names, defaults, and a look at a project folder. */
  private wizardContext(): WizardContext {
    return {
      environments: this.known.environments,
      defaults: this.config.serviceDefaults,
      exists: (environment, name) => this.registry.find(environment, name) !== null,
      inspect: (path) => this.deployments.inspectProject(path),
    };
  }

  /** True when the service's images are built from a project folder (in that environment, or in any). */
  private isBuiltFromFolder(app: string, environment: string | undefined): boolean {
    const environments = environment === undefined ? this.known.environments : [environment];
    return environments.some((name) => this.registry.find(name, app)?.folder != null);
  }

  /** Joins a message with what came before it. */
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
