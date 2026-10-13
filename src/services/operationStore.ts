import { randomUUID } from "node:crypto";

import { MAX_KEPT_OPERATIONS } from "@/constants/deployment.ts";
import type { NewOperation, Operation, OperationStage, OperationState } from "@/types/deployment.ts";

export class OperationStore {
  private readonly operations = new Map<string, Operation>();
  private readonly kept: number;

  /** @param kept how many operations to remember; the oldest are forgotten first. */
  constructor(kept: number = MAX_KEPT_OPERATIONS) {
    this.kept = kept;
  }

  create(input: NewOperation): Operation {
    const operation: Operation = { id: randomUUID(), ...input, state: "running", steps: [], message: "" };
    if (input.stages !== undefined) {
      operation.stage = input.stages[0];
    }
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

  /** Records which stage is running now. */
  setStage(id: string, stage: OperationStage): void {
    const operation = this.operations.get(id);
    if (operation !== undefined) {
      operation.stage = stage;
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
