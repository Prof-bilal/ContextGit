import { memo, useCallback, useEffect, useRef, useState } from "react";
import { LuArrowLeft, LuArrowRight, LuExternalLink, LuFileCode2, LuGlobe, LuRefreshCw, LuX } from "react-icons/lu";
import { browserAddress } from "../../../shared/browser";
import type { Workspace } from "../../../shared/workspace";
import type { EditorStatus } from "../../../shared/editor";
import { measure } from "./performance";

const IDLE_MS = 45_000;
const bridge = () => window.contextgit;

function useVisible() {
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

const ChildWebview = memo(function ChildWebview({ url, title }: { url: string | null; title: string }) {
  return <div className="cg-preview-viewport">
    {!url && <span className="cg-preview-empty">{title}</span>}
    {url && <iframe title={title} src={url} className="cg-preview-frame" sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads" />}
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
    {view ? <ChildWebview url={view.url} title="VS Code" /> :
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
  const [generation, setGeneration] = useState(0);
  const [resident, setResident] = useState(active);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const editingAddress = useRef(false);
  const reportError = useCallback((message: string) => { setError(message); setLoading(false); }, []);
  useEffect(() => {
    const saved = browserCache.get(projectKey) ?? null;
    setSource(saved); setCurrentUrl(saved ?? ""); setManualUrl(saved ?? "");
    setError(null); setTitle(saved ? "Browser" : "New tab"); setLoading(Boolean(saved));
  }, [projectKey]);
  useEffect(() => {
    if (active) { setResident(true); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled || activeRef.current) return;
      setResident(false);
      measure("browser.idle.released");
    }, IDLE_MS);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [active]);
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
      setSource(next);
      editingAddress.current = false;
    } catch (cause) { reportError(String(cause)); }
  };
  const action = (action: string) => {
    setError(null);
    if (action === "stop") setLoading(false);
    else if (action === "reload") { setLoading(true); setGeneration(value => value + 1); }
  };
  const openExternal = () => {
    if (!currentUrl) return;
    window.open(currentUrl, "_blank", "noopener,noreferrer");
  };
  return <section className="cg-workbench-preview" aria-label="Web browser">
    <form className="cg-browser-toolbar" onSubmit={event => { event.preventDefault(); navigate(); }}>
      <button type="button" className="cg-icon-btn" disabled aria-label="Back"><LuArrowLeft /></button>
      <button type="button" className="cg-icon-btn" disabled aria-label="Forward"><LuArrowRight /></button>
      <button type="button" className="cg-icon-btn" disabled={!currentUrl} aria-label={loading ? "Stop loading" : "Reload page"} onClick={() => {
        if (loading) action("stop");
        else action("reload");
      }}>{loading ? <LuX /> : <LuRefreshCw />}</button>
      <LuGlobe className="cg-browser-globe" aria-hidden="true" />
      <input value={manualUrl} onChange={event => setManualUrl(event.target.value)} onFocus={() => { editingAddress.current = true; }} onBlur={() => { editingAddress.current = false; }} placeholder="Search the web or enter a website address" aria-label="Browser URL" autoComplete="off" autoCapitalize="off" spellCheck={false} />
      <button type="submit" className="cg-btn cg-btn-sm">Go</button>
      <button type="button" className="cg-icon-btn" disabled aria-label="Developer tools unavailable in browser mode">Dev</button>
      <button type="button" className="cg-icon-btn" disabled={!currentUrl} aria-label="Open in default browser" onClick={openExternal}><LuExternalLink /></button>
    </form>
    <div className="cg-browser-page-status" role="status"><span>{title}</span><span>{loading ? "Loading…" : currentUrl ? "Ready" : "Websites and local servers"}</span></div>
    {error && <div className="cg-banner" role="alert">{error}</div>}
    {!source ? <div className="cg-browser-new-tab"><LuGlobe /><h2>Browse the web</h2><p>Enter a website or search above.</p><small>Public HTTPS websites and local development servers are supported.</small></div> :
      resident && <ChildWebview key={generation} url={source} title="Web browser" />}
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
