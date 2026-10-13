import { useCallback, useEffect, useRef, useState } from "react";
import { type Session } from "@/shared/api";
import { loadClosed, loadOpenPanes, pushClosed, saveOpenPanes, loadDismissedAgentTabs, saveDismissedAgentTabs, type ClosedPane } from "./storage/recentlyClosed";
import { useSessionResource, useTeamResource, useProjectResource, useTrashResource, useRepoResource } from "./WorkbenchResources";
import { useProjectState } from "./useProjectState";

export function useWorkbenchState() {
  // Team mode was removed from the primary desktop UI. Keep the value stable
  // for older consumers while ensuring stale localStorage cannot reopen it.
  const mode = "single" as "single" | "team";

  const { sessions, loaded: sessionsLoaded, loadedProjects, removedIds, error: sessionsError, refresh, create, remove, setAutoCommit, stop } = useSessionResource();

  const { board: teamBoard, error: teamError, refresh: refreshTeam, act: teamAct } = useTeamResource();

  const {
    workspace,
    projects,
    activePath,
    error: workspaceError,
    choose,
    pickLocation,
    create: createWorkspace,
    use: useProject,
    forget: forgetProject,
  } = useProjectResource();

  const [projectOpen, setProjectOpen] = useState(false);

  const [openIds, setOpenIds] = useState<string[]>([]);
  const [dismissedTabIds, setDismissedTabIds, dismissedPath] = useProjectState(() => loadDismissedAgentTabs());
  const tabSessions = sessions.filter(session => session.kind === "terminal" && !(session.project_path === dismissedPath ? dismissedTabIds : loadDismissedAgentTabs(session.project_path)).includes(session.id));
  useEffect(() => saveDismissedAgentTabs(dismissedTabIds, dismissedPath), [dismissedTabIds, dismissedPath]);

  const [activeId, setActiveId] = useProjectState<string | null>(null);

  const [revision, setRevision] = useState(0);

  const [kickoff, setKickoff] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!removedIds.length) return;
    // A project switch can temporarily hide sessions owned by the previous
    // project while its backend is being rebound. Keep their panes and PTYs
    // alive so switching projects does not kill user work.
    setActiveId((current) => current && removedIds.includes(current) ? null : current);
  }, [removedIds]);

  const {
    sessions: trashSessions,
    branches: trashBranches,
    error: trashError,
    refresh: refreshTrash,
    removeSession: removeStoredSession,
    removeBranch: removeStoredBranch,
    clearStored,
  } = useTrashResource();

  const [closedPanes, setClosedPanes] = useState<ClosedPane[]>(() => loadClosed());

  const { snapshot, loading: repoLoading, error: repoError, refresh: refreshRepo } = useRepoResource();

  const openSession = useCallback((session: Session) => {
    setDismissedTabIds(current => current.filter(id => id !== session.id));
    setOpenIds((current) => (current.includes(session.id) ? current : [...current, session.id]));
    setActiveId(session.id);

  }, [setActiveId, setDismissedTabIds]);

  const closeTerminal = useCallback(async (session: Session) => {
    // The pane owns its PTY and kills it on unmount; just drop it from the layout.
    setOpenIds((current) => current.filter((id) => id !== session.id));
    setActiveId((current) => (current === session.id ? null : current));
    // Remember it so it can be reopened from Storage → Recently closed.
    setClosedPanes(
      pushClosed({
        id: session.id,
        name: session.name,
        kind: session.kind,
        at: new Date().toISOString(),
      }),
    );
    // Closing a terminal also stops its backend run, so the rail does not keep
    // showing a loading/working state for a process that is no longer open.
    try {
      await stop(session.id);
    } catch {
      // The pane is already closed; polling will reconcile a transient backend error.
    }
  }, [stop, setActiveId]);

  const closeAgentTab = useCallback((session: Session) => {
    setDismissedTabIds(current => [...new Set([...current, session.id])]);
    void closeTerminal(session);
  }, [closeTerminal, setDismissedTabIds]);

  const restoredPanes = useRef(false);
  const restoredProjects = useRef(new Set<string>());

  useEffect(() => {
    if (!activePath || restoredProjects.current.has(activePath) || !loadedProjects.includes(activePath)) return;
    restoredProjects.current.add(activePath);
    restoredPanes.current = true;
    const valid = loadOpenPanes(activePath).filter((id) => sessions.some((session) => session.id === id && session.project_path === activePath));
    if (valid.length > 0) {
      setOpenIds((current) => [...new Set([...current, ...valid])]);
      setActiveId((current) => current ?? valid[valid.length - 1]);
    }
  }, [sessions, loadedProjects, activePath, setActiveId]);

  useEffect(() => {
    if (!activePath || !restoredProjects.current.has(activePath)) return;
    saveOpenPanes(openIds.filter(id => sessions.some(session => session.id === id && session.project_path === activePath)), activePath);
  }, [openIds, activePath, sessions]);
  return { mode, sessions, tabSessions, closeAgentTab, sessionsLoaded, removedIds, sessionsError, refresh, create, remove, setAutoCommit, stop, teamBoard, teamError, refreshTeam, teamAct, workspace, projects, activePath, workspaceError, choose, pickLocation, createWorkspace, useProject, forgetProject, projectOpen, setProjectOpen, openIds, setOpenIds, activeId, setActiveId, revision, setRevision, kickoff, setKickoff, trashSessions, trashBranches, trashError, refreshTrash, removeStoredSession, removeStoredBranch, clearStored, closedPanes, setClosedPanes, snapshot, repoLoading, repoError, refreshRepo, openSession, closeTerminal, restoredPanes };
}
