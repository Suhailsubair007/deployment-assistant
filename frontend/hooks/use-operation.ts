"use client";

import { useEffect, useState } from "react";

import { getOperation } from "@/lib/api";
import { messageOf } from "@/lib/http";
import type { Operation } from "@/lib/types";
import { PROGRESS_POLL_MS } from "@/lib/constants";

/** Asks the server once a second how a running change is doing. */
export function useOperation(operationId: string) {
  const [operation, setOperation] = useState<Operation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function check(): Promise<void> {
      try {
        const answer = await getOperation(operationId);
        if (stopped) {
          return;
        }
        setOperation(answer.operation);
        if (answer.operation.state === "running") {
          timer = setTimeout(check, PROGRESS_POLL_MS);
        }
      } catch (caught) {
        if (!stopped) {
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
