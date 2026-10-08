import { useCallback, useEffect, useRef, useState } from "react";
import { type ProviderCapability, type Session } from "@/lib/api";
import { type ModelSelection } from "./providers";
import { type PaneLayout } from "./terminal/PaneCanvas";
import { type WhyRequest } from "./why/useWhy";
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
  const [mode, setMode] = useState<"single" | "team">(() => {
    try { return window.localStorage.getItem("cg-code-mode") === "team" ? "team" : "single"; }
    catch { return "single"; }
  });

  const [layout, setLayout] = useState<PaneLayout>("single");

  const { sessions, loaded: sessionsLoaded, removedIds, error: sessionsError, refresh, create, remove, setAutoCommit } = useSessionResource();

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
    setOpenIds((current) => current.filter((id) => !removedIds.includes(id)));
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

  const [whyRequest, setWhyRequest] = useState<WhyRequest | null>(null);

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

  const changeMode = useCallback((next: "single" | "team") => {
    setMode(next);
    try { window.localStorage.setItem("cg-code-mode", next); } catch { /* Keep in-memory mode. */ }
    setLayout(next === "team" ? "split" : "single");
  }, []);

  const closeTerminal = useCallback((session: Session) => {
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
  }, []);

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
  return { mode, setMode, layout, setLayout, sessions, sessionsLoaded, removedIds, sessionsError, refresh, create, remove, setAutoCommit, teamBoard, teamError, refreshTeam, teamAct, workspace, projects, activePath, workspaceError, choose, pickLocation, createWorkspace, useProject, forgetProject, projectOpen, setProjectOpen, openIds, setOpenIds, activeId, setActiveId, revision, setRevision, kickoff, setKickoff, trashSessions, trashBranches, trashError, refreshTrash, closedPanes, setClosedPanes, snapshot, repoLoading, repoError, refreshRepo, providers, providersError, addProvider, removeProvider, testProvider, fetchProviderModels, model, setModel, whyRequest, setWhyRequest, pickerOpen, setPickerOpen, providerDialog, setProviderDialog, openProviderDialog, openSession, changeMode, closeTerminal, restoredPanes };
}
