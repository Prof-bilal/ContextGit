import { useCallback, useEffect, useRef, useState } from "react";
import { type ProviderCapability, type Session } from "@/lib/api";
import { type ModelSelection } from "./providers";
import { loadClosed, loadOpenPanes, pushClosed, saveOpenPanes, type ClosedPane } from "./storage/recentlyClosed";
import { useSessionResource, useTeamResource, useProjectResource, useTrashResource, useRepoResource, useProviderResource } from "./WorkbenchResources";

const MODEL_KEY = "cg-chat-model";
function readStoredModel(): ModelSelection | null {
  try {
    const raw = window.localStorage.getItem(MODEL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ModelSelection>;
    if (
      typeof parsed.providerId === "string" &&
      parsed.providerId &&
      typeof parsed.modelId === "string"
    ) {
      return { providerId: parsed.providerId, modelId: parsed.modelId };
    }
  } catch {
    // ignore malformed storage
  }
  return null;
}

export function useWorkbenchState() {
  // Team mode was removed from the primary desktop UI. Keep the value stable
  // for older consumers while ensuring stale localStorage cannot reopen it.
  const mode = "single" as "single" | "team";

  const { sessions, loaded: sessionsLoaded, removedIds, error: sessionsError, refresh, create, remove, setAutoCommit, stop } = useSessionResource();

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

  const [activeId, setActiveId] = useState<string | null>(null);

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
  } = useTrashResource();

  const [closedPanes, setClosedPanes] = useState<ClosedPane[]>(() => loadClosed());

  const { snapshot, loading: repoLoading, error: repoError, refresh: refreshRepo } = useRepoResource();

  const {
    providers,
    error: providersError,
    add: addProvider,
    remove: removeProvider,
    test: testProvider,
    fetchModels: fetchProviderModels,
  } = useProviderResource();

  const [model, setModel] = useState<ModelSelection>(
    () => readStoredModel() ?? { providerId: "", modelId: "" },
  );

  const [pickerOpen, setPickerOpen] = useState(false);

  const [providerDialog, setProviderDialog] = useState<{
    capability?: ProviderCapability;
    initialId?: string;
  } | null>(null);

  const openProviderDialog = useCallback(
    (capability?: ProviderCapability, initialId?: string) =>
      setProviderDialog({ capability, initialId }),
    [],
  );

  useEffect(() => {
    if (!model.providerId) return;
    try {
      window.localStorage.setItem(MODEL_KEY, JSON.stringify(model));
    } catch {
      // storage can be unavailable; the selection still applies this session
    }
  }, [model]);

  const openSession = useCallback((session: Session) => {
    setOpenIds((current) => (current.includes(session.id) ? current : [...current, session.id]));
    setActiveId(session.id);

  }, []);

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
  }, [stop]);

  const restoredPanes = useRef(false);

  useEffect(() => {
    if (restoredPanes.current || !sessionsLoaded) return;
    restoredPanes.current = true;
    const valid = loadOpenPanes().filter((id) => sessions.some((session) => session.id === id));
    if (valid.length > 0) {
      setOpenIds((current) => [...new Set([...current, ...valid])]);
      setActiveId((current) => current ?? valid[valid.length - 1]);
    }
  }, [sessions, sessionsLoaded]);

  useEffect(() => {
    if (!restoredPanes.current) return;
    saveOpenPanes(openIds);
  }, [openIds]);
  return { mode, sessions, sessionsLoaded, removedIds, sessionsError, refresh, create, remove, setAutoCommit, stop, teamBoard, teamError, refreshTeam, teamAct, workspace, projects, activePath, workspaceError, choose, pickLocation, createWorkspace, useProject, forgetProject, projectOpen, setProjectOpen, openIds, setOpenIds, activeId, setActiveId, revision, setRevision, kickoff, setKickoff, trashSessions, trashBranches, trashError, refreshTrash, closedPanes, setClosedPanes, snapshot, repoLoading, repoError, refreshRepo, providers, providersError, addProvider, removeProvider, testProvider, fetchProviderModels, model, setModel, pickerOpen, setPickerOpen, providerDialog, setProviderDialog, openProviderDialog, openSession, closeTerminal, restoredPanes };
}
