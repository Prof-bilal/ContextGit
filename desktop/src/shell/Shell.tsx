import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ComponentType, type SetStateAction } from "react";
import { shellActivity } from "./activity";
import { LuCommand, LuExternalLink, LuFolderOpen, LuMoon, LuPanelRight, LuSun, LuTerminal } from "react-icons/lu";
import CommandPalette, { type PaletteCommand } from "./CommandPalette";
import TopNav, { type PrimaryTabId, type TabDef, type TabId } from "./TopNav";
import { IconButton } from "./primitives";
import { Dock } from "./Dock";
import { FeatureBoundary } from "./FeatureBoundary";
import { WorkbenchContext, type WorkbenchSlots } from "./WorkbenchContext";
import { WorkbenchResources } from "./WorkbenchResources";
import { useWorkbenchState } from "./useWorkbenchState";
import { WorkspaceDialogs } from "./WorkspaceDialogs";
import TerminalHost from "./terminal/TerminalHost";
import CodeFeature from "./features/CodeFeature";
import GitFeature from "./features/GitFeature";
import { EditorFeature, BrowserFeature } from "./features/WorkspaceFeature";
import { UpdateCheckButton } from "../UpdateBanner";
import ProjectTabs from "./ProjectTabs";
import { useSyncExternalStore } from "react";
import { projectRuntime } from "../../shared/projectRuntime";

const FEATURES: Array<TabDef & { title: string; Controller: ComponentType }> = [
  { id: "code", label: "Workspace", title: "Task", Controller: CodeFeature },
  { id: "git", label: "Advanced Git", title: "History", Controller: GitFeature },
  { id: "editor", label: "Editor", title: "Editor", Controller: EditorFeature },
  { id: "browser", label: "Browser", title: "Browser", Controller: BrowserFeature },
];
const TABS: TabDef[] = FEATURES.map(({ id, label }) => ({ id, label }));
const NO_DOCK: PrimaryTabId[] = ["editor", "browser"];

function initialTab(): PrimaryTabId {
  const value = new URLSearchParams(window.location.search).get("tab");
  const primary = FEATURES.find(feature => feature.id === value)?.id as PrimaryTabId | undefined;
  const redirected = primary ?? "code";
  if (value && value !== redirected) {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", redirected);
    window.history.replaceState(null, "", url);
  }
  return redirected;
}

export default function Shell(props: { backendAvailable?: boolean }) {
  return <WorkbenchResources><WorkbenchFrame {...props} /></WorkbenchResources>;
}

/** Only stable layout and coordination live here. Feature hooks run in sibling controllers. */
function WorkbenchFrame({ backendAvailable = true }: { backendAvailable?: boolean }) {
  const project = useSyncExternalStore(projectRuntime.subscribe, projectRuntime.read);
  const [tab, setActiveTab] = useState<PrimaryTabId>(initialTab);
  useLayoutEffect(() => shellActivity.update({ tab }), [tab]);
  const setTab = useCallback((next: SetStateAction<PrimaryTabId>) => {
    setActiveTab(current => {
      const value = typeof next === "function" ? next(current) : next;
      return value;
    });
  }, []);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [dockOpen, setDockOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const shared = useWorkbenchState();
  const [overlays, setOverlays] = useState<Partial<Record<TabId, boolean>>>({});
  const setFeatureOverlay = useCallback((id: TabId, open: boolean) => {
    setOverlays(current => current[id] === open ? current : { ...current, [id]: open });
  }, []);
  const overlayOpen = Object.values(overlays).some(Boolean) || shared.projectOpen || !!shared.checkpointSession || paletteOpen;
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat && (!overlayOpen || paletteOpen)) setPaletteOpen(value => !value);
      }
    };
    window.addEventListener("keydown", shortcut, true);
    return () => window.removeEventListener("keydown", shortcut, true);
  }, [overlayOpen, paletteOpen]);
  const [slots, setSlots] = useState<WorkbenchSlots>({ rail: null, dock: null, footer: null, dialogs: null, views: {} });
  // Stable ref callbacks prevent portals from being torn down on ordinary state updates.
  const hosts = useMemo(() => {
    const region = (key: "rail" | "dock" | "footer" | "dialogs") => (node: HTMLDivElement | null) => {
      setSlots(current => current[key] === node ? current : { ...current, [key]: node });
    };
    return {
      rail: region("rail"), dock: region("dock"), footer: region("footer"), dialogs: region("dialogs"),
      views: Object.fromEntries(FEATURES.map(({ id }) => [id, (node: HTMLDivElement | null) => {
        setSlots(current => current.views[id] === node ? current : { ...current, views: { ...current.views, [id]: node } });
      }])) as Record<TabId, (node: HTMLDivElement | null) => void>
    };
  }, []);
  const selected = FEATURES.find(feature => feature.id === tab) ?? FEATURES[0];
  const dockTitle = selected.title;
  const commands: PaletteCommand[] = paletteOpen ? [
    ...TABS.map(view => ({ id: `view:${view.id}`, label: `Switch to ${view.label}`, icon: <LuCommand />, run: () => setTab(view.id) })),
    { id: "project:open", label: "Open project folder", icon: <LuFolderOpen />, run: () => shared.setProjectOpen(true) },
    ...(shared.workspace && backendAvailable && project.ready ? [{ id: "terminal:new", label: "Open project terminal", detail: shared.workspace.path, icon: <LuTerminal />, run: async () => {
      const names = new Set(shared.sessions.map(session => session.name));
      let number = 1;
      while (names.has(`Terminal ${number}`)) number++;
      const session = await shared.create(`Terminal ${number}`, "shell", shared.workspace!.path, [], undefined, [], false);
      setTab("code"); shared.openSession(session);
    } }] : []),
    { id: "theme", label: `Switch to ${theme === "dark" ? "light" : "dark"} theme`, icon: <LuSun />, run: () => setTheme(value => value === "dark" ? "light" : "dark") },
    { id: "inspector", label: `${dockOpen ? "Hide" : "Show"} inspector`, icon: <LuPanelRight />, run: () => setDockOpen(value => !value) },
    { id: "window", label: "Open new window", icon: <LuExternalLink />, run: async () => {
      if (!window.contextgit?.newWindow) throw new Error("New windows require the desktop app.");
      await window.contextgit.newWindow();
    } },
    ...shared.projects.map(project => ({ id: `project:${project.path}`, label: `Open project: ${project.name}`, detail: project.path, icon: <LuFolderOpen />, run: () => shared.useProject(project.path) })),
    ...shared.tabSessions.filter(session => session.project_path === shared.workspace?.path).map(session => ({ id: `session:${session.id}`, label: `Open session: ${session.name}`, detail: session.agent, icon: <LuTerminal />, run: () => { setTab("code"); shared.openSession(session); } })),
  ] : [];

  return <WorkbenchContext.Provider value={{ ...shared, tab, setTab, theme, dockOpen, backendAvailable: backendAvailable && project.ready, overlayOpen, setFeatureOverlay, slots }}>
    <div className="cg-shell" data-cg-theme={theme} data-active-tab={tab}>
      <header className="cg-titlebar">
        <span className="cg-brand">Context<b>Git</b><small>WORKSPACE</small></span>
        <div className="cg-titlebar-center">
          <TopNav tabs={TABS} active={tab} onChange={setTab} />
        </div>
        <span className="cg-titlebar-spacer" />
        <button type="button" className="cg-command-hint" aria-label="Open command palette" title={`Command palette (${isMac ? "⌘K" : "Ctrl+K"})`}
          aria-haspopup="dialog" aria-expanded={paletteOpen} onClick={() => setPaletteOpen(value => !value)}>
          {isMac ? <LuCommand aria-hidden="true" /> : <span>Ctrl</span>}K
        </button>
        <UpdateCheckButton />
        <button type="button" className="cg-theme-btn" onClick={() => void window.contextgit?.newWindow()} title="Open another ContextGit window">
          <LuExternalLink aria-hidden="true" /> New window
        </button>
      <button type="button" className="cg-theme-btn" aria-pressed={theme === "dark"} onClick={() => setTheme(value => value === "dark" ? "light" : "dark")}>
          <span aria-hidden="true">{theme === "dark" ? <LuSun /> : <LuMoon />}</span>{theme === "dark" ? "Light" : "Dark"}
        </button>
        <IconButton label={dockOpen ? "Hide inspector" : "Show inspector"} pressed={dockOpen} onClick={() => setDockOpen(value => !value)}>
          <LuPanelRight aria-hidden="true" />
        </IconButton>
      </header>
      <ProjectTabs
        projects={shared.projects}
        activePath={shared.activePath}
        sessions={shared.tabSessions}
        openIds={shared.openIds}
        onUseProject={shared.useProject}
        onForgetProject={shared.forgetProject}
        onChooseProject={() => shared.setProjectOpen(true)}
      />
      <div className="cg-body" data-tab={tab} data-dock={dockOpen && !NO_DOCK.includes(tab) ? "open" : "closed"}>
        <div className="cg-slot" ref={hosts.rail} />
        <main className="cg-main" id={`cg-panel-${tab}`} role="tabpanel" aria-labelledby={`cg-tab-${tab}`}>
          {FEATURES.map(({ id }) => <div key={id} className="cg-view" data-active={tab === id} data-code-mode={id === "code" ? shared.mode : undefined}>
            <div className={id === "code" ? "cg-slot" : "cg-feature-content"} ref={hosts.views[id]} />
            {id === "code" && <FeatureBoundary feature="Terminals" target={slots.views.code ?? null}><TerminalHost /></FeatureBoundary>}
          </div>)}
        </main>
        {/* Keep the portal host mounted when the inspector is hidden. */}
        <div className="cg-dock-host" hidden={!dockOpen || NO_DOCK.includes(tab)}>
          <Dock title={dockTitle} onClose={() => setDockOpen(false)}><div className="cg-slot" ref={hosts.dock} /></Dock>
        </div>
      </div>
      <div className="cg-slot" ref={hosts.footer} />
      <div className="cg-slot" ref={hosts.dialogs} />
      {FEATURES.map(({ id, label, Controller }) => <FeatureBoundary key={id} feature={label} target={slots.views[id] ?? null}>
        <Controller />
      </FeatureBoundary>)}
      <FeatureBoundary feature="Workspace dialogs" target={slots.dialogs}><WorkspaceDialogs /></FeatureBoundary>
      {paletteOpen && <CommandPalette commands={commands} onClose={closePalette} />}
    </div>
  </WorkbenchContext.Provider>;
}
