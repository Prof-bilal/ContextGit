import { useCallback, useEffect, useState } from "react";

import { api, type Session } from "@/lib/api";

/** In a plain browser there is no Electron bridge and no local API to poll. */
const HAS_BRIDGE = typeof window !== "undefined" && Boolean(window.contextgit);

/**
 * Live terminal sessions from the backend (`GET /api/v1/sessions`), polled so
 * status changes and runs created elsewhere show up.
 */
export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!HAS_BRIDGE) return;
    try {
      setSessions(await api.sessions());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load runs");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, [refresh]);

  const create = useCallback(async (name: string, agent: string) => {
    const created = await api.createSession({ name, kind: "terminal", agent });
    setSessions((current) => [...current, created]);
    return created;
  }, []);

  const remove = useCallback(async (id: string) => {
    await api.deleteSession(id);
    setSessions((current) => current.filter((session) => session.id !== id));
  }, []);

  const setAutoCommit = useCallback(async (id: string, autoCommit: boolean) => {
    const updated = await api.updateSession(id, { auto_commit: autoCommit });
    setSessions((current) => current.map((session) => (session.id === id ? updated : session)));
    return updated;
  }, []);

  return { sessions, error, refresh, create, remove, setAutoCommit };
}
