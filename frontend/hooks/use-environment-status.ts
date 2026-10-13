"use client";

import { useCallback, useEffect, useState } from "react";

import { getStatus } from "@/lib/api";
import { messageOf } from "@/lib/http";
import type { EnvironmentSummary } from "@/lib/types";

/** What the status panel shows, and the function behind its Refresh button. */
export function useEnvironmentStatus() {
  // null until the first check has answered; the panel shows placeholder cards meanwhile.
  const [environments, setEnvironments] = useState<EnvironmentSummary[] | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(true);

  // useCallback keeps this the same function on every draw, so effects that use it do not run again.
  const refresh = useCallback(async (): Promise<void> => {
    setIsRefreshing(true);
    try {
      const status = await getStatus();
      setEnvironments(status.environments);
      setCheckedAt(status.checkedAt);
      setError(null);
    } catch (caught) {
      // Cards from an earlier check stay; the panel greys them. Placeholder cards go away.
      setEnvironments((earlier) => earlier ?? []);
      setError(messageOf(caught));
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { environments, checkedAt, error, isRefreshing, refresh };
}

export type EnvironmentStatusState = ReturnType<typeof useEnvironmentStatus>;
