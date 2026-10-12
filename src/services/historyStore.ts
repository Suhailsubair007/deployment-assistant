// The deployment history, kept in SQLite. It also acts as the lock that allows
// only one change per environment at a time.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { DeployInProgressError } from "../errors.ts";

export type DeploymentAction = "deploy" | "rollback" | "scale";
export type DeploymentStatus = "in_progress" | "succeeded" | "failed" | "timed_out" | "interrupted";

export interface DeploymentRecord {
  id: number;
  environment: string;
  app: string;
  action: DeploymentAction;
  /** Image after this change. */
  image: string;
  /** Image that was running before this change; null when the app was not deployed yet. */
  previousImage: string | null;
  replicas: number;
  status: DeploymentStatus;
  requestedBy: string;
  /** How it ended, for example why it failed. */
  message: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

/** What is known when a deployment starts. */
export type NewDeployment = Pick<
  DeploymentRecord,
  "environment" | "app" | "action" | "image" | "previousImage" | "replicas" | "requestedBy"
>;

export interface HistoryFilter {
  limit: number;
  requestedBy?: string;
  environment?: string;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS deployments (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    environment    TEXT NOT NULL,
    app            TEXT NOT NULL,
    action         TEXT NOT NULL,
    image          TEXT NOT NULL,
    previous_image TEXT,
    replicas       INTEGER NOT NULL,
    status         TEXT NOT NULL,
    requested_by   TEXT NOT NULL,
    message        TEXT,
    started_at     TEXT NOT NULL,
    finished_at    TEXT
  );

  -- The lock: the database itself refuses a second row with status 'in_progress'
  -- for the same environment, even if two requests arrive in the same instant.
  CREATE UNIQUE INDEX IF NOT EXISTS one_active_deployment_per_environment
    ON deployments (environment) WHERE status = 'in_progress';
`;

/** 7 -> "dep-007". */
export function formatDeploymentId(id: number): string {
  return `dep-${String(id).padStart(3, "0")}`;
}

type Row = Record<string, unknown>;

function toRecord(row: Row): DeploymentRecord {
  return {
    id: Number(row.id),
    environment: String(row.environment),
    app: String(row.app),
    action: row.action as DeploymentAction,
    image: String(row.image),
    previousImage: row.previous_image === null ? null : String(row.previous_image),
    replicas: Number(row.replicas),
    status: row.status as DeploymentStatus,
    requestedBy: String(row.requested_by),
    message: row.message === null ? null : String(row.message),
    startedAt: new Date(String(row.started_at)),
    finishedAt: row.finished_at === null ? null : new Date(String(row.finished_at)),
  };
}

export class HistoryStore {
  private readonly db: DatabaseSync;

  /** @param path file to store the history in, or ":memory:" for a store that is not saved. */
  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  /**
   * Records the start of a change and takes the environment's lock.
   * Throws DeployInProgressError when another change to that environment is still running.
   */
  start(deployment: NewDeployment): DeploymentRecord {
    try {
      const result = this.db
        .prepare(
          `INSERT INTO deployments
             (environment, app, action, image, previous_image, replicas, status, requested_by, started_at)
           VALUES (?, ?, ?, ?, ?, ?, 'in_progress', ?, ?)`,
        )
        .run(
          deployment.environment,
          deployment.app,
          deployment.action,
          deployment.image,
          deployment.previousImage,
          deployment.replicas,
          deployment.requestedBy,
          new Date().toISOString(),
        );
      return this.byId(Number(result.lastInsertRowid));
    } catch (error) {
      // The unique index refused the row: say who holds the lock. Anything else is a real error.
      this.assertFree(deployment.environment);
      throw error;
    }
  }

  /** Throws DeployInProgressError when a change to this environment is still running. */
  assertFree(environment: string): void {
    const active = this.activeIn(environment);
    if (active !== null) {
      throw new DeployInProgressError(
        `${environment} already has a deployment in progress ` +
          `(${formatDeploymentId(active.id)}, started by ${active.requestedBy}). Try again when it finishes.`,
      );
    }
  }

  /** Records how a change ended. This releases the environment's lock. */
  finish(id: number, status: Exclude<DeploymentStatus, "in_progress">, message?: string): void {
    this.db
      .prepare("UPDATE deployments SET status = ?, message = ?, finished_at = ? WHERE id = ?")
      .run(status, message ?? null, new Date().toISOString(), id);
  }

  /** The most recent deploy or rollback (not scaling, which keeps the image), or null. */
  latestImageChange(environment: string, app: string): DeploymentRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM deployments
          WHERE environment = ? AND app = ? AND action != 'scale'
          ORDER BY id DESC LIMIT 1`,
      )
      .get(environment, app);
    return row === undefined ? null : toRecord(row);
  }

  /** Newest first. */
  list(filter: HistoryFilter): DeploymentRecord[] {
    const conditions: string[] = [];
    const values: (string | number)[] = [];
    if (filter.requestedBy !== undefined) {
      conditions.push("requested_by = ?");
      values.push(filter.requestedBy);
    }
    if (filter.environment !== undefined) {
      conditions.push("environment = ?");
      values.push(filter.environment);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    return this.db
      .prepare(`SELECT * FROM deployments ${where} ORDER BY id DESC LIMIT ?`)
      .all(...values, filter.limit)
      .map(toRecord);
  }

  /**
   * Called once at startup. A row still 'in_progress' then belongs to a run of the
   * assistant that stopped half-way; nobody is watching that rollout any more.
   * Marking it 'interrupted' frees the environment. Returns how many rows were changed.
   */
  recoverInterrupted(): number {
    const result = this.db
      .prepare(
        `UPDATE deployments
            SET status = 'interrupted',
                message = 'The assistant stopped before this finished.',
                finished_at = ?
          WHERE status = 'in_progress'`,
      )
      .run(new Date().toISOString());
    return Number(result.changes);
  }

  private byId(id: number): DeploymentRecord {
    const row = this.db.prepare("SELECT * FROM deployments WHERE id = ?").get(id);
    if (row === undefined) {
      throw new Error(`Deployment ${id} is missing from the history.`);
    }
    return toRecord(row);
  }

  private activeIn(environment: string): DeploymentRecord | null {
    const row = this.db
      .prepare("SELECT * FROM deployments WHERE environment = ? AND status = 'in_progress'")
      .get(environment);
    return row === undefined ? null : toRecord(row);
  }
}
