import { useCallback, useState } from "react";

import { api, type TeamBoard } from "@/lib/api";
import { useBackendPolling } from "../useBackendPolling";
import { useTransientError } from "../useTransientError";

/** In a plain browser there is no Electron bridge and no local API to poll. */
const HAS_BRIDGE = typeof window !== "undefined" && Boolean(window.contextgit);

/**
 * The team board (`GET /api/v1/team`), polled like the fleet so dependency
 * changes and messages other runs post show up without a manual refresh.
 */
export function useTeam(intervalMs = 4000) {
  const [board, setBoard] = useState<TeamBoard | null>(null);
  const { error, reportSuccess, reportFailure } = useTransientError();

  const load = useCallback(async (current: () => boolean) => {
    if (!HAS_BRIDGE || !current()) return;
    try {
      const next = await api.team();
      if (!current()) return;
      setBoard(next);
      reportSuccess();
    } catch (cause) {
      if (!current()) return;
      reportFailure(cause instanceof Error ? cause.message : "Could not load the team board");
    }
  }, [reportSuccess, reportFailure]);

  const refresh = useBackendPolling(load, intervalMs);

  /** Run a mutation, then re-read the board so gating state is never stale. */
  const act = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      const result = await action();
      await refresh();
      return result;
    },
    [refresh],
  );

  return { board, error, refresh, act };
}
