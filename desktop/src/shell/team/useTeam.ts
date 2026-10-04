import { useCallback, useEffect, useState } from "react";

import { api, type TeamBoard } from "@/lib/api";

/** In a plain browser there is no Electron bridge and no local API to poll. */
const HAS_BRIDGE = typeof window !== "undefined" && Boolean(window.contextgit);

/**
 * The team board (`GET /api/v1/team`), polled like the fleet so dependency
 * changes and messages other runs post show up without a manual refresh.
 */
export function useTeam(intervalMs = 4000) {
  const [board, setBoard] = useState<TeamBoard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!HAS_BRIDGE) return;
    try {
      setBoard(await api.team());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the team board");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);

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
