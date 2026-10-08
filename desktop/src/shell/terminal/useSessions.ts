import { useCallback, useEffect, useRef, useState } from "react";

import { api, ApiError, type Session } from "@/lib/api";
import { SessionRevision, uniqueSessions } from "./sessionState";
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
  const revision = useRef(new SessionRevision());
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const creating = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const connected = () => !HAS_BRIDGE || window.contextgit?.getStatus().status.state === "ready";

  const refresh = useCallback(async () => {
    if (!HAS_BRIDGE || !connected()) return;
    const ticket = revision.current.begin();
    try {
      const next = uniqueSessions(await api.sessions());
      if (!revision.current.accepts(ticket)) return;
      const ids = new Set(next.map((session) => session.id));
      const removed: string[] = [];
      // A list omission is not evidence that a live process should die.
      await Promise.all(sessionsRef.current.filter((session) => !ids.has(session.id)).map(async (previous) => {
        try {
          const current = await api.session(previous.id);
          if (current.deleted_at) removed.push(previous.id);
          else next.push(current);
        } catch (cause) {
          if (cause instanceof ApiError && cause.status === 404 && cause.kind === "SessionNotFound") removed.push(previous.id);
          else next.push(previous);
        }
      }));
      if (!revision.current.accepts(ticket)) return;
      setSessions(uniqueSessions(next));
      setRemovedIds(removed);
      setLoaded(true);
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
      if (!connected()) throw new Error("The backend is unavailable. Reconnect before starting a run.");
      if (creating.current) throw new Error("A run is already starting. Please wait.");
      creating.current = true;
      try {
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
        revision.current.changed();
        // A poll can land between the POST and this append and already contain the
        // run; guard so the rail never renders the same session twice.
        setSessions((current) =>
          current.some((session) => session.id === created.id) ? current : [...current, created],
        );
        setLoaded(true);
        return created;
      } finally { creating.current = false; }
    },
    [],
  );

  const remove = useCallback(async (id: string) => {
    await api.deleteSession(id);
    revision.current.changed();
    setRemovedIds((current) => [...new Set([...current, id])]);
    setSessions((current) => current.filter((session) => session.id !== id));
  }, []);

  const setAutoCommit = useCallback(async (id: string, autoCommit: boolean) => {
    const updated = await api.updateSession(id, { auto_commit: autoCommit });
    revision.current.changed();
    setSessions((current) => current.map((session) => (session.id === id ? updated : session)));
    return updated;
  }, []);

  return { sessions, loaded, removedIds, error, refresh, create, remove, setAutoCommit };
}
