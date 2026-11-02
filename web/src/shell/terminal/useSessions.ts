import { useCallback, useRef, useState } from "react";

import { api, projectApi, ApiError, type Session } from "@/shared/api";
import { projectRuntime } from "../../../shared/projectRuntime";
import { SessionRevision, uniqueSessions } from "./sessionState";
import { useBackendPolling } from "../useBackendPolling";
import { useTransientError } from "../useTransientError";
import { useShellActivity } from "../activity";

/** Browser mode polls the local API for session state. */
const hasBridge = () => typeof window !== "undefined" && Boolean(window.contextgit);

/**
 * Live terminal sessions from the backend (`GET /api/v1/sessions`), polled so
 * status changes and runs created elsewhere show up.
 */
export function useSessions() {
  const activity = useShellActivity();
  const [sessions, setSessions] = useState<Session[]>([]);
  const { error, reportSuccess, reportFailure } = useTransientError();
  const revision = useRef(new SessionRevision());
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const creating = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [loadedProjects, setLoadedProjects] = useState<string[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const connected = () => !hasBridge() || window.contextgit?.getStatus().status.state === "ready";

  const load = useCallback(async (current: () => boolean) => {
    if (!hasBridge() || !connected() || !current()) return;
    const ticket = revision.current.begin();
    const owner = projectRuntime.read().path;
    const scoped = projectApi(owner ?? undefined);
    try {
      const next = uniqueSessions(await scoped.sessions());
      if (!current() || !revision.current.accepts(ticket)) return;
      const ids = new Set(next.map((session) => session.id));
      const removed: string[] = [];
      // A list omission is not evidence that a live process should die.
      await Promise.all(sessionsRef.current.filter((session) => session.project_path === owner && !ids.has(session.id)).map(async (previous) => {
        try {
          const current = await scoped.session(previous.id);
          if (current.deleted_at) removed.push(previous.id);
          else next.push(current);
        } catch (cause) {
          if (cause instanceof ApiError && cause.status === 404 && cause.kind === "SessionNotFound") removed.push(previous.id);
          else next.push(previous);
        }
      }));
      if (!current() || !revision.current.accepts(ticket)) return;
      setSessions(previous => {
        const value = uniqueSessions([...previous.filter(session => session.project_path !== owner), ...next]);
        return JSON.stringify(previous) === JSON.stringify(value) ? previous : value;
      });
      setRemovedIds(previous => previous.join() === removed.join() ? previous : removed);
      setLoaded(true);
      if (owner) setLoadedProjects(previous => previous.includes(owner) ? previous : [...previous, owner]);
      reportSuccess();
    } catch (cause) {
      if (!current()) return;
      reportFailure(cause instanceof Error ? cause.message : "Could not load runs");
    }
  }, [reportSuccess, reportFailure]);

  const refresh = useBackendPolling(load, activity.tab === "code" ? 4000 : 15000);

  const create = useCallback(
    async (
      name: string,
      agent: string,
      projectPath?: string,
      scope?: string[],
      role?: string,
      skills?: string[],
      worktree = true,
      category = "",
      model?: string,
    ) => {
      if (!connected() || !projectRuntime.read().ready) throw new Error("This project is still loading. Please wait or retry opening it.");
      if (creating.current) throw new Error("A run is already starting. Please wait.");
      creating.current = true;
      try {
        const created = await api.createSession({
          name,
          kind: "terminal",
          agent,
          model,
          projectPath,
          // A shared project-root run is useful for quick investigation; an
          // isolated worktree remains the safe default for edits.
          worktree: Boolean(projectPath) && worktree,
          scope: scope ?? [],
          role,
          skills,
          category,
        });
        revision.current.changed();
        // A poll can land between the POST and this append and already contain the
        // run; guard so the rail never renders the same session twice.
        setSessions((current) =>
          current.some((session) => session.id === created.id) ? current : [...current, created],
        );
        setLoaded(true);
        return created;
      } catch (cause) {
        if (cause instanceof ApiError && ["network", "timeout"].includes(cause.kind ?? "") && projectPath) {
          try {
            const next = await projectApi(projectPath).sessions();
            setSessions(previous => uniqueSessions([...previous.filter(session => session.project_path !== projectPath), ...next]));
          } catch { /* Keep the uncertainty visible; never repeat the POST. */ }
        }
        throw cause;
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

  const addSession = useCallback((session: Session) => {
    revision.current.changed();
    setSessions((current) =>
      current.some((entry) => entry.id === session.id) ? current : [...current, session],
    );
    setLoaded(true);
  }, []);

  const setAutoCommit = useCallback(async (id: string, autoCommit: boolean) => {
    const updated = await api.updateSession(id, { auto_commit: autoCommit });
    revision.current.changed();
    setSessions((current) => current.map((session) => (session.id === id ? updated : session)));
    return updated;
  }, []);

  const stop = useCallback(async (id: string) => {
    const updated = await api.updateSession(id, { status: "idle" });
    revision.current.changed();
    setSessions((current) => current.map((session) => (session.id === id ? updated : session)));
    return updated;
  }, []);

  return { sessions, loaded, loadedProjects, removedIds, error, refresh, create, addSession, remove, setAutoCommit, stop };
}
