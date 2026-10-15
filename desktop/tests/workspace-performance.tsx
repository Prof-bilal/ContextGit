import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { WorkbenchContext, type WorkbenchContextValue } from "../src/shell/WorkbenchContext";
import { EditorFeature, BrowserFeature } from "../src/shell/features/WorkspaceFeature";
import { useBackendPolling } from "../src/shell/useBackendPolling";
import { projectRuntime } from "../shared/projectRuntime";
import { shellActivity, useShellActivity } from "../src/shell/activity";
import { useLimits } from "../src/shell/terminal/useLimits";
import type { PrimaryTabId } from "../src/shell/TopNav";
import "../src/shell.css";

const counters = { created: 0, closed: 0, bounds: 0, shown: 0, hidden: 0, starts: 0, stops: 0, sessionReads: 0, gitReads: 0, storageReads: 0, limitsReads: 0, probes: 0 };
let running = false;
let instance = 0;
let dirty = false;
let nativeUrl = "http://127.0.0.1:3000/deep/page";
let startGate: Promise<void> | null = null;
let releaseStart: (() => void) | undefined;
const views = new Map<string, string>();
const nativeViews = new Map<string, any>();
const browserListeners = new Set<(event: any) => void>();
const ready = () => ({ state: "ready", instanceId: String(instance), url: "http://127.0.0.1:19876/" });
(window as any).workspaceTest = {
  counters, tab: (_tab: PrimaryTabId) => {}, dirty: (value: boolean) => { dirty = value; },
  nativeUrl: (value: string) => {
    nativeUrl = value;
    const label = [...views.keys()].find(label => label.startsWith("contextgit-preview-"));
    if (label) for (const listener of browserListeners) listener({ payload: { label, url: value, title: "Public website", loading: false } });
  },
  storage: (value: boolean) => shellActivity.update({ storageOpen: value }),
  deferStart: () => { startGate = new Promise(resolve => { releaseStart = resolve; }); },
  releaseStart: () => { releaseStart?.(); startGate = null; },
  visibility: (value: boolean) => {
    Object.defineProperty(document, "hidden", { configurable: true, value: !value });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: value ? "visible" : "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  },
};
window.contextgit = {
  getStatus: () => ({ status: { state: "ready" }, apiBase: "http://127.0.0.1:19875" }),
  refreshBackendStatus: async () => ({ status: { state: "ready" }, apiBase: "http://127.0.0.1:19875" }),
  onStatus: () => () => {},
  editorStart: async () => { if (!running) { running = true; instance++; counters.starts++; } if (startGate) await startGate; return ready(); },
  editorStatus: async () => ready(),
  editorSuspend: async (id: string) => {
    if (id !== String(instance)) return { state: "stopped" };
    if (dirty) return { ...ready(), state: "retained", message: "Unsaved files keep VS Code in memory." };
    if (running) { running = false; counters.stops++; }
    return { state: "stopped" };
  },
  editorStop: async (id: string) => { if (id === String(instance) && running) { running = false; counters.stops++; } },
} as any;
(window as any).__TAURI__ = {
  core: { invoke: async (name: string, args: any) => {
    if (name === "native_view_bounds") counters.bounds++;
    if (name === "native_view_url") return nativeUrl;
    if (name === "browser_create") { new (window as any).__TAURI__.webview.Webview({}, args.label, { url: args.url }); nativeUrl = args.url; }
    if (name === "browser_snapshot") return { label: args.label, url: views.get(args.label), title: "Website", loading: false };
    if (name === "browser_navigate") {
      views.set(args.label, args.url); nativeUrl = args.url;
      for (const listener of browserListeners) listener({ payload: { label: args.label, url: args.url, title: "Website", loading: false } });
    }
  } },
  event: { listen: async (_name: string, listener: (event: any) => void) => { browserListeners.add(listener); return () => browserListeners.delete(listener); } },
  window: { getCurrentWindow: () => ({}) },
  webview: { Webview: class {
    label: string;
    constructor(_window: unknown, label: string, options: {url: string}) { this.label = label; views.set(label, options.url); nativeViews.set(label, this); counters.created++; }
    static async getByLabel(label: string) { return nativeViews.get(label); }
    once(name: string, handler: () => void) { if (name === "tauri://created") queueMicrotask(handler); return Promise.resolve(() => {}); }
    close() { if (views.delete(this.label)) counters.closed++; nativeViews.delete(this.label); return Promise.resolve(); }
    show() { counters.shown++; return Promise.resolve(); }
    hide() { counters.hidden++; return Promise.resolve(); }
  } },
};
const actualFetch = window.fetch;
window.fetch = async (input, init) => {
  if (String(input).includes("/api/v1/limits?")) { counters.limitsReads++; return new Response("[]"); }
  if (String(input).endsWith("/projects/open")) return new Response(JSON.stringify({ projectId: "test", repoId: "test", path: "/tmp/editor-test" }));
  if (/^http:\/\/127.0.0.1:\d+/.test(String(input))) { counters.probes++; throw new Error("No local server"); }
  return actualFetch(input, init);
};
projectRuntime.select("/tmp/editor-test");

function PollingChecks() {
  const activity = useShellActivity();
  useLimits(activity.tab === "code", { id: "test", agent: "codex" } as any);
  useBackendPolling(async () => { counters.sessionReads++; }, activity.tab === "code" ? 4000 : 15000);
  useBackendPolling(async () => { counters.gitReads++; }, 0, { active: activity.tab === "git" });
  useBackendPolling(async () => { counters.storageReads++; }, 4000, { active: activity.tab === "git" && activity.storageOpen });
  return null;
}
function Harness() {
  const [tab, setTab] = useState<PrimaryTabId>("editor");
  const [slots, setSlots] = useState<any>({ views: {} });
  const [refs] = useState(() => Object.fromEntries(["editor", "browser"].map(id => [id, (node: HTMLElement | null) => setSlots((value: any) => value.views[id] === node ? value : { views: { ...value.views, [id]: node } })])));
  (window as any).workspaceTest.tab = setTab;
  useEffect(() => shellActivity.update({ tab }), [tab]);
  const [workspace] = useState(() => ({ path: "/tmp/editor-test", name: "editor-test", parent: "/tmp", revision: 1 }));
  const context = { workspace, tab, slots, overlayOpen: false } as WorkbenchContextValue;
  return <WorkbenchContext.Provider value={context}><div className="cg-shell">
    <header style={{height:36}}>ContextGit</header><nav style={{height:36}}>Project tabs</nav>
    <div className="cg-body" data-tab={tab} data-dock="closed"><div className="cg-slot" /><main className="cg-main">
      {(["editor", "browser"] as const).map(id => <div className="cg-view" data-active={tab === id} key={id}><div className="cg-feature-content" ref={refs[id]} /></div>)}
    </main></div><div /><EditorFeature /><BrowserFeature /><PollingChecks />
  </div></WorkbenchContext.Provider>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
