// Progress of changes that are running right now, kept in memory.
// The browser asks for an operation by ID to show "2/3 pods ready" while a rollout runs.

import { randomUUID } from "node:crypto";

export type OperationState = "running" | "succeeded" | "failed";

export interface Operation {
  id: string;
  /** The history row this operation belongs to. */
  deploymentId: number;
  environment: string;
  app: string;
  state: OperationState;
  /** Progress so far, oldest first: "1/3 pods ready", "2/3 pods ready", ... */
  steps: string[];
  /** The final message, once the operation is no longer running. */
  message: string;
}

export type NewOperation = Pick<Operation, "deploymentId" | "environment" | "app">;

const DEFAULT_KEPT = 200;

export class OperationStore {
  private readonly operations = new Map<string, Operation>();
  private readonly kept: number;

  /** @param kept how many operations to remember; the oldest are forgotten first. */
  constructor(kept: number = DEFAULT_KEPT) {
    this.kept = kept;
  }

  create(input: NewOperation): Operation {
    const operation: Operation = { id: randomUUID(), ...input, state: "running", steps: [], message: "" };
    this.operations.set(operation.id, operation);

    // A Map remembers insertion order, so its first key is the oldest operation.
    while (this.operations.size > this.kept) {
      const oldest = this.operations.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.operations.delete(oldest);
    }
    return operation;
  }

  get(id: string): Operation | null {
    return this.operations.get(id) ?? null;
  }

  /** Adds a progress step, unless it repeats the previous one. */
  addStep(id: string, step: string): void {
    const operation = this.operations.get(id);
    if (operation !== undefined && operation.steps.at(-1) !== step) {
      operation.steps.push(step);
    }
  }

  finish(id: string, state: Exclude<OperationState, "running">, message: string): void {
    const operation = this.operations.get(id);
    if (operation !== undefined) {
      operation.state = state;
      operation.message = message;
    }
  }
}
