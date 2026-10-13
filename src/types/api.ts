import type { Agent } from "@/agent/agent.ts";
import type { SessionStore } from "@/agent/sessionStore.ts";
import type { OperationStore } from "@/services/operationStore.ts";
import type { StatusService } from "@/services/statusService.ts";

export interface UserError {
  /** HTTP status code for the response. */
  status: number;
  message: string;
}

export type ErrorLogger = (...parts: unknown[]) => void;

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
