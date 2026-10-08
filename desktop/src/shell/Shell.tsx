import { useCallback, useMemo, useState, type SetStateAction } from "react";
import { LuCommand, LuMoon, LuPanelRight, LuSun } from "react-icons/lu";
import TopNav, { type PrimaryTabId, type TabDef, type TabId } from "./TopNav";
import { IconButton, MiniSeg } from "./primitives";
import { Dock } from "./Dock";
import { FeatureBoundary } from "./FeatureBoundary";
import { WorkbenchContext, type WorkbenchSlots } from "./WorkbenchContext";
import { WorkbenchResources } from "./WorkbenchResources";
import { useWorkbenchState } from "./useWorkbenchState";
import { WorkspaceDialogs } from "./WorkspaceDialogs";
import TerminalHost from "./terminal/TerminalHost";
import ChatFeature from "./features/ChatFeature";
import CodeFeature from "./features/CodeFeature";
import AssetsFeature from "./features/AssetsFeature";
import AgentFeature from "./features/AgentFeature";
import GitFeature from "./features/GitFeature";

const FEATURES = [
  { id: "chat", label: "Chat", title: "Conversation", Controller: ChatFeature },
  { id: "code", label: "Code", title: "Run", Controller: CodeFeature },
  { id: "agent", label: "Agent", title: "Agent", Controller: AgentFeature },
  { id: "git", label: "Git", title: "Commit", Controller: GitFeature },
  { id: "assets", label: "Assets", title: "Asset", Controller: AssetsFeature },
] as const satisfies readonly (TabDef & { title: string; Controller: typeof ChatFeature })[];
const TABS: TabDef[] = FEATURES.map(({ id, label }) => ({ id, label }));
const MODE_OPTIONS = [{ value: "single" as const, label: "Single" }, { value: "team" as const, label: "Team" }];
const NO_DOCK: PrimaryTabId[] = [];

const LEGACY_TAB_REDIRECTS: Record<Exclude<TabId, PrimaryTabId>, PrimaryTabId> = {
  storage: "git",
  editor: "code",
  api: "code",
  endpoints: "code",
  why: "code",
  db: "code",
  browser: "chat",
  playground: "agent",
  usage: "agent",
};

function initialTab(): PrimaryTabId {
  const value = new URLSearchParams(window.location.search).get("tab");
  const primary = FEATURES.find(feature => feature.id === value)?.id as PrimaryTabId | undefined;
  const redirected = primary ?? (value && value in LEGACY_TAB_REDIRECTS
    ? LEGACY_TAB_REDIRECTS[value as Exclude<TabId, PrimaryTabId>]
    : undefined) ?? "code";
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
  const [tab, setActiveTab] = useState<PrimaryTabId>(initialTab);
  const setTab = useCallback((next: SetStateAction<TabId>) => {
    setActiveTab(current => {
      const value = typeof next === "function" ? next(current) : next;
      return Object.prototype.hasOwnProperty.call(LEGACY_TAB_REDIRECTS, value)
        ? LEGACY_TAB_REDIRECTS[value as Exclude<TabId, PrimaryTabId>]
        : value as PrimaryTabId;
    });
  }, []);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [dockOpen, setDockOpen] = useState(true);
  const shared = useWorkbenchState();
  const [overlays, setOverlays] = useState<Partial<Record<TabId, boolean>>>({});
  const setFeatureOverlay = useCallback((id: TabId, open: boolean) => {
    setOverlays(current => current[id] === open ? current : { ...current, [id]: open });
  }, []);
  const overlayOpen = Object.values(overlays).some(Boolean) || shared.pickerOpen || shared.providerDialog !== null || shared.projectOpen;
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
  const dockTitle = tab === "code" && shared.mode === "team" ? "Task" : selected.title;

  return <WorkbenchContext.Provider value={{ ...shared, tab, setTab, theme, dockOpen, backendAvailable, overlayOpen, setFeatureOverlay, slots }}>
    <div className="cg-shell" data-cg-theme={theme}>
      <header className="cg-titlebar">
        <span className="cg-brand">Context<b>Git</b><small>WORKSPACE</small></span>
        <TopNav tabs={TABS} active={tab} onChange={setTab} />
        {tab === "code" && <MiniSeg value={shared.mode} options={MODE_OPTIONS} onChange={shared.changeMode} label="Code mode" />}
        <span className="cg-titlebar-spacer" />
        <button type="button" className="cg-command-hint"><LuCommand aria-hidden="true" />K</button>
        <button type="button" className="cg-theme-btn" aria-pressed={theme === "dark"} onClick={() => setTheme(value => value === "dark" ? "light" : "dark")}>
          <span aria-hidden="true">{theme === "dark" ? <LuSun /> : <LuMoon />}</span>{theme === "dark" ? "Light" : "Dark"}
        </button>
        <IconButton label={dockOpen ? "Hide inspector" : "Show inspector"} pressed={dockOpen} onClick={() => setDockOpen(value => !value)}>
          <LuPanelRight aria-hidden="true" />
        </IconButton>
      </header>
      <div className="cg-body" data-dock={dockOpen && !NO_DOCK.includes(tab) ? "open" : "closed"}>
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
    </div>
  </WorkbenchContext.Provider>;
}
