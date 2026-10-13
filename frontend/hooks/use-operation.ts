"use client";

import { useEffect, useState } from "react";

import { getOperation } from "@/lib/api";
import { messageOf } from "@/lib/http";
import type { Operation } from "@/lib/types";
import { PROGRESS_FAILURES_BEFORE_GIVING_UP, PROGRESS_POLL_MS } from "@/lib/constants";

/** Asks the server once a second how a running change is doing. */
export function useOperation(operationId: string) {
  const [operation, setOperation] = useState<Operation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failuresInARow = 0;

    async function check(): Promise<void> {
      try {
        const answer = await getOperation(operationId);
        if (stopped) {
          return;
        }
        failuresInARow = 0;
        setOperation(answer.operation);
        if (answer.operation.state === "running") {
          timer = setTimeout(check, PROGRESS_POLL_MS);
        }
      } catch (caught) {
        if (stopped) {
          return;
        }
        failuresInARow += 1;
        if (failuresInARow < PROGRESS_FAILURES_BEFORE_GIVING_UP) {
          // Probably a hiccup: ask again in a second.
          timer = setTimeout(check, PROGRESS_POLL_MS);
        } else {
          setError(messageOf(caught));
        }
      }
    }
    void check();

    // When the message leaves the screen, the questions stop.
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [operationId]);

  return { operation, error };
}
