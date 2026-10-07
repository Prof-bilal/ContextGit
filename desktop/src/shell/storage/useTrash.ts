import { useCallback, useEffect, useState } from "react";

import { api, type Branch, type Session } from "@/lib/api";
import { useTransientError } from "../useTransientError";

/** In a plain browser there is no Electron bridge and no local API to poll. */
const HAS_BRIDGE = typeof window !== "undefined" && Boolean(window.contextgit);

/**
 * Storage contents from the backend (`GET /api/v1/trash`), polled so trashed
 * runs and branches appear and disappear as they are moved around.
 */
export function useTrash() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const { error, reportSuccess, reportFailure } = useTransientError();

  const refresh = useCallback(async () => {
    if (!HAS_BRIDGE) return;
    try {
      const snapshot = await api.trash();
      setSessions(snapshot.sessions);
      setBranches(snapshot.branches);
      reportSuccess();
    } catch (cause) {
      reportFailure(cause instanceof Error ? cause.message : "Could not load Storage");
    }
  }, [reportSuccess, reportFailure]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, [refresh]);

  return { sessions, branches, error, refresh };
}
