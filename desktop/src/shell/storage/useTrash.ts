import { useCallback, useState } from "react";

import { api, type Branch, type Session } from "@/lib/api";
import { useBackendPolling } from "../useBackendPolling";
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

  const load = useCallback(async (current: () => boolean) => {
    if (!HAS_BRIDGE || !current()) return;
    try {
      const snapshot = await api.trash();
      if (!current()) return;
      setSessions(snapshot.sessions);
      setBranches(snapshot.branches);
      reportSuccess();
    } catch (cause) {
      if (!current()) return;
      reportFailure(cause instanceof Error ? cause.message : "Could not load Storage");
    }
  }, [reportSuccess, reportFailure]);

  const refresh = useBackendPolling(load, 4000);

  return { sessions, branches, error, refresh };
}
