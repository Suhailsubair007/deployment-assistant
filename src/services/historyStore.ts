import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { HISTORY_SCHEMA } from "@/constants/deployment.ts";
import { DeployInProgressError } from "@/errors.ts";
import type {
  DeploymentAction,
  DeploymentRecord,
  DeploymentStatus,
  HistoryFilter,
  NewDeployment,
  Row,
} from "@/types/deployment.ts";

/** 7 -> "dep-007". */
export function formatDeploymentId(id: number): string {
  return `dep-${String(id).padStart(3, "0")}`;
}

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
    this.db.exec(HISTORY_SCHEMA);
  }

  /** Records the start of a change and takes the environment's lock. */
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

  /** The most recent change of any kind to this app in this environment, or null. */
  latest(environment: string, app: string): DeploymentRecord | null {
    const row = this.db
      .prepare("SELECT * FROM deployments WHERE environment = ? AND app = ? ORDER BY id DESC LIMIT 1")
      .get(environment, app);
    return row === undefined ? null : toRecord(row);
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

  /** Called once at startup. */
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
