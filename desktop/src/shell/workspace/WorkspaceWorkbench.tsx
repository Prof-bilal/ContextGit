import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuChevronDown, LuChevronRight, LuExternalLink, LuFileCode2, LuFolder, LuFolderOpen, LuPanelRight, LuRefreshCw } from "react-icons/lu";
import type { Workspace } from "../../../shared/workspace";
import type { FileNode } from "../../../shared/workspaceFiles";

const PREVIEW_PORTS = [3000, 4173, 5173, 8000, 8080, 3001, 4200];

function bridge() {
  return window.contextgit;
}

function tauriRuntime(): any {
  return (window as Window & { __TAURI__?: any }).__TAURI__;
}

function ChildWebview({ label, url, visible, title }: { label: string; url: string | null; visible: boolean; title: string }) {
  const host = useRef<HTMLDivElement>(null);
  const child = useRef<any>(null);
  const [native, setNative] = useState(false);

  useEffect(() => {
    const runtime = tauriRuntime();
    const element = host.current;
    if (!runtime?.webview?.Webview || !runtime?.window?.getCurrentWindow || !element || !url) return;
    const currentWindow = runtime.window.getCurrentWindow();
    const rect = element.getBoundingClientRect();
    const view = new runtime.webview.Webview(currentWindow, label, {
      url,
      x: Math.max(0, Math.round(rect.left)),
      y: Math.max(0, Math.round(rect.top)),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    });
    child.current = view;
    setNative(true);
    return () => { child.current = null; setNative(false); void view.close?.(); };
  }, [label, url]);

  useEffect(() => {
    const element = host.current;
    const view = child.current;
    if (!element || !view) return;
    const sync = () => {
      const rect = element.getBoundingClientRect();
      void view.setPosition?.({ type: "Logical", x: Math.round(rect.left), y: Math.round(rect.top) });
      void view.setSize?.({ type: "Logical", width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) });
      if (visible) void view.show?.(); else void view.hide?.();
    };
    const observer = new ResizeObserver(sync);
    observer.observe(element); window.addEventListener("resize", sync); sync();
    return () => { observer.disconnect(); window.removeEventListener("resize", sync); };
  }, [visible, native]);

  return <div ref={host} className="cg-preview-viewport" data-native={native}>
    {!url && <span className="cg-preview-empty">{title}</span>}
    {url && !native && <iframe title={title} src={url} className="cg-preview-frame" sandbox="allow-scripts allow-same-origin allow-forms allow-modals" />}
  </div>;
}

function Explorer({ project, selected, onSelect }: { project: Workspace; selected: string | null; onSelect: (node: FileNode) => void }) {
  const [nodes, setNodes] = useState<FileNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [children, setChildren] = useState<Record<string, FileNode[]>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (relative = ".") => {
    const api = bridge();
    if (!api) return;
    try {
      const next = await api.filesList(project.path, relative);
      if (relative === ".") setNodes(next);
      else setChildren((current) => ({ ...current, [relative]: next }));
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not read project files"); }
  }, [project.path]);

  useEffect(() => { setExpanded(new Set()); setChildren({}); void load(); }, [load]);

  const toggle = async (node: FileNode) => {
    if (node.kind !== "directory") return onSelect(node);
    const next = new Set(expanded);
    if (next.has(node.path)) next.delete(node.path);
    else { next.add(node.path); if (!children[node.path]) await load(node.path); }
    setExpanded(next);
  };

  const render = (entries: FileNode[], depth = 0) => entries.map((node) => <div key={node.path}>
    <button type="button" className="cg-file-row" data-selected={selected === node.path} style={{ paddingLeft: `${0.55 + depth * 0.8}rem` }} onClick={() => void toggle(node)} title={node.path}>
      {node.kind === "directory" ? (expanded.has(node.path) ? <LuChevronDown /> : <LuChevronRight />) : <span className="cg-file-indent" />}
      {node.kind === "directory" ? (expanded.has(node.path) ? <LuFolderOpen /> : <LuFolder />) : <LuFileCode2 />}
      <span>{node.name}</span>
    </button>
    {node.kind === "directory" && expanded.has(node.path) && render(children[node.path] ?? [], depth + 1)}
  </div>);

  return <aside className="cg-workbench-explorer">
    <div className="cg-workbench-head"><span>Files</span><button type="button" className="cg-icon-btn" aria-label="Refresh files" onClick={() => void load()}><LuRefreshCw /></button></div>
    <div className="cg-file-tree">{error ? <p className="cg-empty-note">{error}</p> : nodes.length ? render(nodes) : <p className="cg-empty-note">No files found.</p>}</div>
  </aside>;
}

function Editor({ project, file }: { project: Workspace; file: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [message, setMessage] = useState("Starting VS Code…");
  useEffect(() => {
    let alive = true;
    setMessage("Starting VS Code…");
    void bridge()?.editorStart(project.path).then((status) => {
      if (!alive) return;
      if (status.url) { setUrl(`${status.url}${status.url.includes("?") ? "&" : "?"}${file ? `file=${encodeURIComponent(file)}` : ""}`.replace(/&$/, "")); setMessage("VS Code"); }
      else setMessage(status.message ?? "VS Code is unavailable");
    }).catch((cause: unknown) => { if (alive) setMessage(cause instanceof Error ? cause.message : "VS Code is unavailable"); });
    return () => { alive = false; };
  }, [file, project.path]);

  return <section className="cg-workbench-editor">
    <div className="cg-workbench-head"><span>{file ?? "VS Code"}</span><span className="cg-editor-status">{message}</span></div>
    <ChildWebview label="contextgit-editor" url={url} visible title="VS Code editor" />
  </section>;
}

function BrowserPanel({ project }: { project: Workspace }) {
  const [port, setPort] = useState<number | null>(null);
  const [checking, setChecking] = useState(true);
  const [manual, setManual] = useState("");
  const [reload, setReload] = useState(0);
  const url = port ? `http://127.0.0.1:${port}` : null;

  useEffect(() => {
    let alive = true;
    setChecking(true); setPort(null);
    const check = async () => {
      for (const candidate of PREVIEW_PORTS) {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 350);
        try { const response = await fetch(`http://127.0.0.1:${candidate}`, { signal: controller.signal, mode: "no-cors" }); if (alive && (response.ok || response.type === "opaque")) { setPort(candidate); break; } } catch { /* port is not serving */ } finally { window.clearTimeout(timer); }
      }
      if (alive) setChecking(false);
    };
    void check(); return () => { alive = false; };
  }, [project.path]);

  return <section className="cg-workbench-preview">
    <div className="cg-workbench-head"><span>Preview</span><span className="cg-preview-status">{checking ? "Checking local ports…" : url ?? "No local server"}</span><button type="button" className="cg-icon-btn" aria-label="Reload preview" onClick={() => setReload((value) => value + 1)}><LuRefreshCw /></button>{url && <button type="button" className="cg-icon-btn" aria-label="Open preview in browser" onClick={() => window.open(url, "_blank")}><LuExternalLink /></button>}</div>
    <div className="cg-preview-controls"><input value={manual} onChange={(event) => setManual(event.target.value)} placeholder="http://127.0.0.1:5173" aria-label="Preview URL" /><button type="button" className="cg-btn cg-btn-sm" onClick={() => { try { const parsed = new URL(manual.trim()); if ((parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") && parsed.protocol === "http:") setPort(Number(parsed.port)); } catch { /* invalid preview URL */ } }}>Open</button></div>
    <ChildWebview key={`${url ?? "empty"}-${reload}`} label="contextgit-preview" url={url} visible title="Local project preview" />
  </section>;
}

export default function WorkspaceWorkbench({ workspace }: { workspace: Workspace | null }) {
  const [selected, setSelected] = useState<FileNode | null>(null);
  const [previewOpen, setPreviewOpen] = useState(true);
  const file = selected?.kind === "file" ? selected.path : null;
  const project = useMemo(() => workspace, [workspace]);
  if (!project) return <div className="cg-workbench-empty"><strong>Choose a project to open the workspace</strong><span>The file editor and live preview follow the active project.</span></div>;
  return <div className="cg-workbench">
    <Explorer project={project} selected={file} onSelect={setSelected} />
    <Editor project={project} file={file} />
    {previewOpen && <BrowserPanel project={project} />}
    <button type="button" className="cg-workbench-toggle" onClick={() => setPreviewOpen((value) => !value)} aria-label={previewOpen ? "Hide preview" : "Show preview"}><LuPanelRight /></button>
  </div>;
}
