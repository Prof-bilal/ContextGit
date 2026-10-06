import { useCallback, useEffect, useState } from "react";

import { api, type Session } from "@/lib/api";
import { useTransientError } from "../useTransientError";

/** In a plain browser there is no Electron bridge and no local API to poll. */
const HAS_BRIDGE = typeof window !== "undefined" && Boolean(window.contextgit);

/**
 * Live terminal sessions from the backend (`GET /api/v1/sessions`), polled so
 * status changes and runs created elsewhere show up.
 */
export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const { error, reportSuccess, reportFailure } = useTransientError();

  const refresh = useCallback(async () => {
    if (!HAS_BRIDGE) return;
    try {
      setSessions(await api.sessions());
      reportSuccess();
    } catch (cause) {
      reportFailure(cause instanceof Error ? cause.message : "Could not load runs");
    }
  }, [reportSuccess, reportFailure]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, [refresh]);

  const create = useCallback(
    async (
      name: string,
      agent: string,
      projectPath?: string,
      scope?: string[],
      role?: string,
      skills?: string[],
    ) => {
      const created = await api.createSession({
        name,
        kind: "terminal",
        agent,
        projectPath,
        // One git worktree per run when the project is a git repo (backend falls
        // back to the shared workspace otherwise).
        worktree: Boolean(projectPath),
        scope: scope ?? [],
        role,
        skills,
      });
      // A poll can land between the POST and this append and already contain the
      // run; guard so the rail never renders the same session twice.
      setSessions((current) =>
        current.some((session) => session.id === created.id) ? current : [...current, created],
      );
      return created;
    },
    [],
  );

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
