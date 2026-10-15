import { memo, useCallback, useEffect, useRef, useState } from "react";
import { LuArrowLeft, LuArrowRight, LuExternalLink, LuFileCode2, LuGlobe, LuRefreshCw, LuX } from "react-icons/lu";
import { browserAddress, type BrowserState } from "../../../shared/browser";
import type { Workspace } from "../../../shared/workspace";
import type { EditorStatus } from "../../../shared/editor";
import { NativeLayout } from "./nativeLayout";
import { measure } from "./performance";

const IDLE_MS = 45_000;
const bridge = () => window.contextgit;
const tauriRuntime = (): any => (window as Window & { __TAURI__?: any }).__TAURI__;

function useVisible() {
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

type NativeView = { label: string; goBack?: () => Promise<void>; goForward?: () => Promise<void>; reload?: () => Promise<void>; openDevtools?: () => Promise<void>; close: () => Promise<void>; show: () => Promise<void>; hide: () => Promise<void> };

const ChildWebview = memo(function ChildWebview({ label, url, visible, title, onView, onError, onCreateError }: { label: string; url: string | null; visible: boolean; title: string; onView?: (view: NativeView | null) => void; onError?: (message: string) => void; onCreateError?: (message: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const child = useRef<any>(null);
  const callbacks = useRef({ onView, onError, onCreateError });
  callbacks.current = { onView, onError, onCreateError };
  const [native, setNative] = useState(false);

  useEffect(() => {
    const runtime = tauriRuntime();
    const element = host.current;
    if (!element || !url) return;
    if (!runtime?.webview?.Webview || !runtime?.window?.getCurrentWindow) {
      if (runtime) callbacks.current.onError?.("Native webviews are unavailable. Restart the desktop app.");
      return;
    }
    let disposed = false;
    let created = false;
    const rect = element.getBoundingClientRect();
    let view: any = null;
    let createdListener: Promise<() => void> | undefined;
    let errorListener: Promise<() => void> | undefined;
    const viewLabel = `${label}-${crypto.randomUUID()}`;
    const options = {
      url, x: Math.max(0, Math.round(rect.left)), y: Math.max(0, Math.round(rect.top)),
      width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)),
    };
    const attach = (handle: any) => {
      view = handle; created = true;
      if (disposed) { void view.close().catch(() => undefined); return; }
      child.current = view;
      callbacks.current.onView?.(view);
      setNative(true);
    };
    measure("native.create");
    if (label === "contextgit-preview") {
      void runtime.core.invoke("browser_create", { label: viewLabel, ...options })
        .then(() => runtime.webview.Webview.getByLabel(viewLabel))
        .then((handle: any) => { if (!handle) throw new Error("Browser view could not be attached"); attach(handle); })
        .catch((cause: unknown) => { if (!disposed) (callbacks.current.onCreateError ?? callbacks.current.onError)?.(String(cause)); });
    } else {
      view = new runtime.webview.Webview(runtime.window.getCurrentWindow(), viewLabel, options);
      child.current = view;
      createdListener = view.once("tauri://created", () => attach(view));
      errorListener = view.once("tauri://error", (event: { payload: unknown }) => {
        if (!disposed) (callbacks.current.onCreateError ?? callbacks.current.onError)?.(`Could not create the embedded view: ${String(event.payload)}`);
      });
    }
    return () => {
      disposed = true; child.current = null; callbacks.current.onView?.(null); setNative(false);
      if (created) { measure("native.close"); void view.close().catch(() => undefined); }
      void errorListener?.then((off: () => void) => off()).catch(() => undefined);
      if (created) void createdListener?.then((off: () => void) => off()).catch(() => undefined);
    };
  }, [label, url]);

  useEffect(() => {
    const view = child.current;
    if (!native || !view) return;
    measure(visible ? "native.show" : "native.hide");
    void (visible ? view.show() : view.hide()).catch(() => undefined);
  }, [native, visible]);

  useEffect(() => {
    const element = host.current;
    const view = child.current;
    if (!native || !visible || !element || !view) return;
    let frame = 0;
    const layout = new NativeLayout(bounds => {
      measure("native.bounds");
      return tauriRuntime().core.invoke("native_view_bounds", { label: view.label, ...bounds });
    }, error => callbacks.current.onError?.(`Could not position the embedded view: ${String(error)}`));
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();
        layout.update({ x: Math.round(rect.left), y: Math.round(rect.top), width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) });
      });
    };
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    window.addEventListener("resize", sync);
    sync();
    return () => { layout.dispose(); cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("resize", sync); };
  }, [visible, native]);

  return <div ref={host} className="cg-preview-viewport" data-native={native}>
    {!url && <span className="cg-preview-empty">{title}</span>}
    {url && !native && !tauriRuntime() && <iframe title={title} src={url} className="cg-preview-frame" sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads" />}
  </div>;
});

let editorLifecycle: Promise<unknown> = Promise.resolve();
function editorRequest<T>(request: () => Promise<T>): Promise<T> {
  const next = editorLifecycle.then(request, request);
  editorLifecycle = next.catch(() => undefined);
  return next;
}

type EditorView = { url: string; instanceId: string; project: string };
function Editor({ project, active }: { project: Workspace; active: boolean }) {
  const [view, setView] = useState<EditorView | null>(null);
  const [processId, setProcessId] = useState<string | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const [message, setMessage] = useState("Starting VS Code…");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [switching, setSwitching] = useState(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const reportError = useCallback((reason: string) => { setError(true); setMessage(reason); }, []);
  const reportCreateError = useCallback((reason: string) => { setView(null); reportError(reason); }, [reportError]);

  useEffect(() => {
    const api = bridge();
    if (!active || !api) return;
    let alive = true;
    let timer: number | undefined;
    const started = performance.now();
    setError(false); setNotice(null);
    setSwitching(Boolean(viewRef.current && viewRef.current.project !== project.path));
    const adopt = (status: EditorStatus, retained = false) => {
      if (!status.url || !status.instanceId) return;
      const url = new URL(status.url);
      if (!retained) url.searchParams.set("folder", project.path);
      setView(previous => previous?.instanceId === status.instanceId ? previous : {
        url: url.toString(), instanceId: status.instanceId!, project: retained ? "" : project.path,
      });
      setSwitching(false);
      measure(retained ? "editor.retained" : "editor.ready", started);
    };
    const poll = async (instanceId?: string) => {
      if (!alive) return;
      try {
        const status = await api.editorStatus(instanceId);
        if (!alive) return;
        if (status.state === "ready" && status.url) { adopt(status); return; }
        if (status.state !== "starting") { reportError(status.message ?? "VS Code stopped. Retry to start it again."); return; }
        if (performance.now() - started > 60_000) { reportError("VS Code is taking too long to start. Retry to reconnect."); return; }
        timer = window.setTimeout(() => void poll(instanceId), 500);
      } catch (cause) { if (alive) reportError(String(cause)); }
    };
    if (!viewRef.current) setMessage("Starting VS Code…");
    else measure("editor.warm.show", started);
    measure("editor.start.request");
    void editorRequest(() => api.editorStart(project.path)).then(status => {
      // A start can finish after the user switches away. Track it even then,
      // otherwise a server without a mounted webview would escape idle cleanup.
      setProcessId(status.instanceId ?? null);
      if (!alive) return;
      if (status.state === "retained") { adopt(status, true); setSwitching(false); setNotice(status.message ?? "Save unsaved files before switching projects."); }
      else if (status.state === "unavailable" || status.state === "error") reportError(status.message ?? "VS Code is unavailable.");
      else if (status.instanceId && status.instanceId === viewRef.current?.instanceId) { measure("editor.warm.ready", started); }
      else void poll(status.instanceId);
    }).catch(cause => { if (alive) reportError(String(cause)); });
    return () => { alive = false; window.clearTimeout(timer); };
  }, [project.path, active, attempt, reportError]);

  useEffect(() => {
    if (active) return;
    let cancelled = false;
    let timer: number;
    const release = () => {
      const api = bridge();
      if (!processId || !api) return;
      void editorRequest(async () => {
        if (activeRef.current) return null;
        if (!viewRef.current) {
          // No client was ever opened, so this cancelled startup has no buffers.
          await api.editorStop(processId);
          return { state: "stopped" } as EditorStatus;
        }
        return api.editorSuspend(processId);
      }).then(status => {
        if (cancelled || activeRef.current || !status) return;
        if (status.state === "retained") {
          setNotice(status.message ?? "Unsaved files keep VS Code in memory.");
          timer = window.setTimeout(release, 15000);
        }
        else {
          setView(previous => previous?.instanceId === processId ? null : previous);
          setProcessId(previous => previous === processId ? null : previous);
        }
        measure(status.state === "retained" ? "editor.idle.retained" : "editor.idle.released");
      }).catch(() => {
        if (!cancelled && !activeRef.current) timer = window.setTimeout(release, 15000);
      });
    };
    timer = window.setTimeout(release, IDLE_MS);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [active, processId]);

  return <section className="cg-workbench-editor" aria-label="VS Code">
    {(notice || (error && view)) && <div className="cg-banner" role="status">{notice ?? message} <button className="cg-btn cg-btn-sm" onClick={() => setAttempt(value => value + 1)}>Retry</button></div>}
    {view ? <ChildWebview label="contextgit-editor" url={view.url} visible={active && !switching} title="VS Code" onError={reportError} onCreateError={reportCreateError} /> :
      <div className="cg-editor-empty" role={error ? "alert" : "status"}>
        <LuFileCode2 /><strong>{error ? "Could not open VS Code" : "Starting VS Code…"}</strong>
        <span>{error ? message : "Opening your project in the full VS Code workbench."}</span>
        {error && <button type="button" className="cg-btn" onClick={() => setAttempt(value => value + 1)}>Retry</button>}
      </div>}
  </section>;
}

const browserCache = new Map<string, string>();
function cacheBrowser(key: string, url: string) {
  browserCache.set(key, url);
  if (browserCache.size > 32) browserCache.delete(browserCache.keys().next().value!);
}
function BrowserPanel({ projectKey, active }: { projectKey: string; active: boolean }) {
  const [source, setSource] = useState<string | null>(() => browserCache.get(projectKey) ?? null);
  const [currentUrl, setCurrentUrl] = useState(source ?? "");
  const [manualUrl, setManualUrl] = useState(source ?? "");
  const [title, setTitle] = useState("New tab");
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [resident, setResident] = useState(active);
  const [error, setError] = useState<string | null>(null);
  const viewRef = useRef<NativeView | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const editingAddress = useRef(false);
  const receive = useCallback((state: BrowserState) => {
    if (state.label !== viewRef.current?.label) return;
    setCurrentUrl(state.url); setTitle(state.title || state.url || "Browser");
    setLoading(state.loading); setError(state.error ?? null);
    cacheBrowser(projectKey, state.url);
    if (!editingAddress.current) setManualUrl(state.url);
  }, [projectKey]);
  const reportError = useCallback((message: string) => { setError(message); setLoading(false); }, []);
  const onView = useCallback((view: NativeView | null) => {
    viewRef.current = view; setConnected(Boolean(view));
    if (view && tauriRuntime()) void tauriRuntime().core.invoke("browser_snapshot", { label: view.label }).then(receive).catch((cause: unknown) => reportError(String(cause)));
  }, [receive, reportError]);
  const snapshot = useCallback(async () => {
    const view = viewRef.current;
    if (!view || !tauriRuntime()) return;
    try {
      const url = await tauriRuntime().core.invoke("native_view_url", { label: view.label });
      if (typeof url === "string") { cacheBrowser(projectKey, url); return url; }
    } catch { /* Keep the last confirmed URL if this view was already closed. */ }
  }, [projectKey]);

  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    void tauriRuntime()?.event?.listen("browser-state", (event: { payload: BrowserState }) => { if (!disposed) receive(event.payload); }).then((unlisten: () => void) => { if (disposed) unlisten(); else off = unlisten; }).catch(reportError);
    return () => { disposed = true; off?.(); };
  }, [receive, reportError]);
  useEffect(() => () => { void snapshot(); }, [snapshot]);
  useEffect(() => {
    const saved = browserCache.get(projectKey) ?? null;
    setSource(saved); setCurrentUrl(saved ?? ""); setManualUrl(saved ?? "");
    setError(null); setTitle(saved ? "Browser" : "New tab"); setLoading(Boolean(saved));
  }, [projectKey]);
  useEffect(() => {
    if (active) { setResident(true); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void snapshot().then(url => {
        if (cancelled || activeRef.current) return;
        if (url) { setCurrentUrl(url); setManualUrl(url); setSource(url); }
        setResident(false);
        measure("browser.idle.released");
      });
    }, IDLE_MS);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [active, snapshot]);
  useEffect(() => {
    if (!loading || !active) return;
    const timer = window.setTimeout(() => setError("This website is taking a long time to respond. You can reload or open it in your default browser."), 30_000);
    return () => window.clearTimeout(timer);
  }, [loading, active, currentUrl]);

  const navigate = () => {
    try {
      const next = browserAddress(manualUrl);
      cacheBrowser(projectKey, next);
      setCurrentUrl(next); setManualUrl(next); setError(null); setLoading(true); setResident(true);
      const view = viewRef.current;
      if (view && tauriRuntime()) void tauriRuntime().core.invoke("browser_navigate", { label: view.label, url: next }).catch((cause: unknown) => reportError(String(cause)));
      else setSource(next);
      editingAddress.current = false;
    } catch (cause) { reportError(String(cause)); }
  };
  const action = (action: string) => {
    const view = viewRef.current;
    if (!view || !tauriRuntime()) return;
    setError(null);
    if (action === "stop") setLoading(false);
    else if (action === "reload") setLoading(true);
    void tauriRuntime().core.invoke("native_view_action", { label: view.label, action }).catch((cause: unknown) => reportError(String(cause)));
  };
  const openExternal = () => {
    if (!currentUrl) return;
    if (tauriRuntime()) void tauriRuntime().core.invoke("browser_open_external", { url: currentUrl }).catch((cause: unknown) => reportError(String(cause)));
    else window.open(currentUrl, "_blank", "noopener,noreferrer");
  };
  return <section className="cg-workbench-preview" aria-label="Web browser">
    <form className="cg-browser-toolbar" onSubmit={event => { event.preventDefault(); navigate(); }}>
      <button type="button" className="cg-icon-btn" disabled={!connected} aria-label="Back" onClick={() => action("back")}><LuArrowLeft /></button>
      <button type="button" className="cg-icon-btn" disabled={!connected} aria-label="Forward" onClick={() => action("forward")}><LuArrowRight /></button>
      <button type="button" className="cg-icon-btn" disabled={!currentUrl} aria-label={loading ? "Stop loading" : "Reload page"} onClick={() => {
        if (loading) action("stop");
        else if (viewRef.current) action("reload");
        else { setSource(currentUrl); setResident(true); setGeneration(value => value + 1); }
      }}>{loading ? <LuX /> : <LuRefreshCw />}</button>
      <LuGlobe className="cg-browser-globe" aria-hidden="true" />
      <input value={manualUrl} onChange={event => setManualUrl(event.target.value)} onFocus={() => { editingAddress.current = true; }} onBlur={() => { editingAddress.current = false; }} placeholder="Search the web or enter a website address" aria-label="Browser URL" autoComplete="off" autoCapitalize="off" spellCheck={false} />
      <button type="submit" className="cg-btn cg-btn-sm">Go</button>
      <button type="button" className="cg-icon-btn" disabled={!connected} aria-label="Open developer tools" onClick={() => action("devtools")}>Dev</button>
      <button type="button" className="cg-icon-btn" disabled={!currentUrl} aria-label="Open in default browser" onClick={openExternal}><LuExternalLink /></button>
    </form>
    <div className="cg-browser-page-status" role="status"><span>{title}</span><span>{loading ? "Loading…" : currentUrl ? "Ready" : "Websites and local servers"}</span></div>
    {error && <div className="cg-banner" role="alert">{error}</div>}
    {!source ? <div className="cg-browser-new-tab"><LuGlobe /><h2>Browse the web</h2><p>Enter a website or search above.</p><small>Public HTTPS websites and local development servers are supported.</small></div> :
      resident && <ChildWebview key={generation} label="contextgit-preview" url={source} visible={active} title="Web browser" onView={onView} onError={reportError} />}
  </section>;
}


export default memo(function WorkspaceWorkbench({ workspace, mode = "editor", active = true }: { workspace: Workspace | null; mode?: "editor" | "browser"; active?: boolean }) {
  const visible = useVisible();
  const shown = active && visible;
  if (!workspace && mode === "editor") return <div className="cg-workbench-empty"><strong>Choose a project</strong><span>VS Code opens the active project folder.</span></div>;
  return <div className="cg-workbench" data-mode={mode}>
    {mode === "editor" ? <Editor project={workspace!} active={shown} /> : <BrowserPanel projectKey={workspace?.path ?? "__browser__"} active={shown} />}
  </div>;
});
