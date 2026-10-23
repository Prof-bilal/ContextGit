import { projectRuntime } from "../shared/projectRuntime";
import type { BackendStatus } from "../shared/status";

type Workspace = import("../shared/workspace").Workspace;
type ContextGitBridge = NonNullable<Window["contextgit"]>;

function query(name: string): string | null {
  return typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(name);
}

function workspace(path: string): Workspace {
  const absolute = path.trim();
  const parts = absolute.replace(/[\\/]+$/, "").split(/[\\/]/);
  return { path: absolute, name: parts.at(-1) || absolute, parent: parts.slice(0, -1).join("/") };
}

export function installWebBridge(): void {
  if (window.contextgit) return;
  const apiBase = query("api") || "http://127.0.0.1:8000";
  const apiToken = query("token") || "";
  const status: BackendStatus = { state: "ready", apiBase };
  const listeners = new Set<(next: BackendStatus) => void>();
  const terminalSockets = new Map<string, WebSocket>();
  const ptyDataListeners = new Set<(id: string, data: string) => void>();
  const ptyExitListeners = new Set<(id: string, code: number | undefined) => void>();
  const projectsKey = "contextgit:web-projects";
  const activeKey = "contextgit:web-active-project";
  let activeProjectId = "";
  const savedProjects = (): Workspace[] => {
    try { return JSON.parse(localStorage.getItem(projectsKey) || "[]") as Workspace[]; } catch { return []; }
  };
  const headers = () => ({ Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" });
  const open = async (path: string): Promise<Workspace> => {
    const response = await fetch(`${apiBase}/api/v1/projects/open`, { method: "POST", headers: headers(), body: JSON.stringify({ path }) });
    if (!response.ok) throw new Error((await response.text()) || "Could not open project");
    const result = await response.json() as { path: string; projectId: string };
    const next = workspace(result.path);
    localStorage.setItem(projectsKey, JSON.stringify([...savedProjects().filter(item => item.path !== next.path), next]));
    localStorage.setItem(activeKey, next.path);
    activeProjectId = result.projectId;
    projectRuntime.select(next.path);
    return next;
  };
  const bridge = new Proxy({
    apiBase,
    apiToken,
    getStatus: () => ({ status, apiBase }),
    runtimeInfo: async () => ({ platform: navigator.platform.toLowerCase().includes("win") ? "win32" : navigator.platform.toLowerCase().includes("mac") ? "darwin" : "linux", arch: "browser", shell: "browser terminal" }),
    refreshBackendStatus: async () => ({ status, apiBase }),
    restartBackend: async () => ({ status, apiBase }),
    onStatus: (callback: (next: BackendStatus) => void) => { listeners.add(callback); callback(status); return () => listeners.delete(callback); },
    listProjects: async () => savedProjects(),
    getWorkspace: async () => { const current = localStorage.getItem(activeKey); return savedProjects().find(item => item.path === current) ?? null; },
    useProject: open,
    filesList: async (project: string, relative = "") => {
      if (project !== localStorage.getItem(activeKey)) await open(project);
      const response = await fetch(`${apiBase}/api/v1/files?relative=${encodeURIComponent(relative)}`, { headers: { ...headers(), "X-ContextGit-Project": activeProjectId } });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    fileRead: async (project: string, relative: string) => {
      if (project !== localStorage.getItem(activeKey)) await open(project);
      const response = await fetch(`${apiBase}/api/v1/files/document?relative=${encodeURIComponent(relative)}`, { headers: { ...headers(), "X-ContextGit-Project": activeProjectId } });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    filePreview: async (project: string, relative: string) => {
      if (project !== localStorage.getItem(activeKey)) await open(project);
      const response = await fetch(`${apiBase}/api/v1/files/preview?relative=${encodeURIComponent(relative)}`, { headers: { ...headers(), "X-ContextGit-Project": activeProjectId } });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    fileWrite: async (project: string, relative: string, content: string, expectedVersion?: string) => {
      if (project !== localStorage.getItem(activeKey)) await open(project);
      const response = await fetch(`${apiBase}/api/v1/files/document`, { method: "PUT", headers: { ...headers(), "X-ContextGit-Project": activeProjectId }, body: JSON.stringify({ path: relative, content, expectedVersion }) });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    chooseWorkspace: async () => { const value = window.prompt("Project folder path"); return value ? open(value) : null; },
    pickWorkspaceLocation: async () => window.prompt("Parent folder path") || null,
    createWorkspace: async (parent: string, name: string) => open(`${parent.replace(/[\\/]$/, "")}/${name}`),
    forgetProject: async (path: string) => { const remaining = savedProjects().filter(item => item.path !== path); localStorage.setItem(projectsKey, JSON.stringify(remaining)); if (localStorage.getItem(activeKey) === path) { localStorage.removeItem(activeKey); projectRuntime.select(null); } return remaining; },
    ptyStart: async (options: { id: string; command: string; cwd?: string; input?: string; env?: Record<string, string> }) => {
      const project = localStorage.getItem(activeKey);
      if (!project) throw new Error("Open a project before starting a terminal.");
      const projectId = await fetch(`${apiBase}/api/v1/projects/open`, { method: "POST", headers: headers(), body: JSON.stringify({ path: project }) }).then(response => response.json()).then(value => String(value.projectId));
      const socket = new WebSocket(`${apiBase.replace(/^http/, "ws")}/api/v1/terminal?token=${encodeURIComponent(apiToken)}&project=${encodeURIComponent(projectId)}`);
      terminalSockets.set(options.id, socket);
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => { socket.send(JSON.stringify({ type: "start", ...options })); resolve(); }, { once: true });
        socket.addEventListener("error", () => reject(new Error("Could not connect to the browser terminal.")), { once: true });
      });
      socket.addEventListener("message", event => {
        let message: { type?: string; data?: string; code?: number; message?: string };
        try { message = JSON.parse(String(event.data)); } catch { return; }
        if (message.type === "data" && typeof message.data === "string") ptyDataListeners.forEach(callback => callback(options.id, message.data!));
        if (message.type === "exit") ptyExitListeners.forEach(callback => callback(options.id, message.code));
        if (message.type === "error") ptyExitListeners.forEach(callback => callback(options.id, undefined));
      });
    },
    ptyWrite: (id: string, data: string) => terminalSockets.get(id)?.send(JSON.stringify({ type: "write", data })),
    ptyResize: (id: string, cols: number, rows: number) => terminalSockets.get(id)?.send(JSON.stringify({ type: "resize", cols, rows })),
    ptyKill: (id: string) => { terminalSockets.get(id)?.send(JSON.stringify({ type: "kill" })); terminalSockets.get(id)?.close(); terminalSockets.delete(id); },
    ptyPresets: async () => ["shell", "codex", "claude", "opencode", "commandcode"],
    harnessCheck: async () => ({ installed: true }),
    harnessInstall: async () => ({ started: false }),
    onHarnessProgress: () => () => {}, onPtyData: (callback: (id: string, data: string) => void) => { ptyDataListeners.add(callback); return () => ptyDataListeners.delete(callback); }, onPtyExit: (callback: (id: string, code: number | undefined) => void) => { ptyExitListeners.add(callback); return () => ptyExitListeners.delete(callback); },
    onUpdateStatus: () => () => {}, getUpdateStatus: () => ({ state: "unsupported" }),
    checkForUpdates: async () => ({ state: "unsupported" }),
    usageActivity: () => {}, onUsage: () => () => {},
    saveFile: async (options: { defaultName: string; data: ArrayBuffer }) => {
      const blob = new Blob([options.data]);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = options.defaultName;
      link.click();
      URL.revokeObjectURL(link.href);
      return options.defaultName;
    },
  } as Record<string, unknown>, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
      if (typeof property === "string" && property.startsWith("on")) return () => () => {};
      return (..._args: unknown[]) => Promise.reject(new Error(`Web mode does not support ${String(property)} yet.`));
    },
  }) as unknown as ContextGitBridge;
  window.contextgit = bridge;
  listeners.forEach(callback => callback(status));
  const initialProject = query("project") || localStorage.getItem(activeKey);
  if (initialProject) void open(initialProject).catch((cause) => console.warn("Could not open launch project", cause));
}
