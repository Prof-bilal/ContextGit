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
  const projectsKey = "contextgit:web-projects";
  const activeKey = "contextgit:web-active-project";
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
    projectRuntime.select(next.path);
    return next;
  };
  const bridge = new Proxy({
    apiBase,
    apiToken,
    getStatus: () => ({ status, apiBase }),
    refreshBackendStatus: async () => ({ status, apiBase }),
    restartBackend: async () => ({ status, apiBase }),
    onStatus: (callback: (next: BackendStatus) => void) => { listeners.add(callback); callback(status); return () => listeners.delete(callback); },
    listProjects: async () => savedProjects(),
    getWorkspace: async () => { const current = localStorage.getItem(activeKey); return savedProjects().find(item => item.path === current) ?? null; },
    useProject: open,
    chooseWorkspace: async () => { const value = window.prompt("Project folder path"); return value ? open(value) : null; },
    pickWorkspaceLocation: async () => window.prompt("Parent folder path") || null,
    createWorkspace: async (parent: string, name: string) => open(`${parent.replace(/[\\/]$/, "")}/${name}`),
    forgetProject: async (path: string) => { const remaining = savedProjects().filter(item => item.path !== path); localStorage.setItem(projectsKey, JSON.stringify(remaining)); if (localStorage.getItem(activeKey) === path) { localStorage.removeItem(activeKey); projectRuntime.select(null); } return remaining; },
    ptyStart: async () => { throw new Error("Browser terminal transport is not available in this build yet."); },
    ptyWrite: () => {}, ptyResize: () => {}, ptyKill: () => {},
    ptyPresets: async () => ["shell", "codex", "claude", "opencode", "commandcode"],
    harnessCheck: async () => ({ installed: true }),
    harnessInstall: async () => ({ started: false }),
    onHarnessProgress: () => () => {}, onPtyData: () => () => {}, onPtyExit: () => () => {},
    onUpdateStatus: () => () => {}, getUpdateStatus: () => ({ state: "unsupported" }),
    checkForUpdates: async () => ({ state: "unsupported" }),
    usageActivity: () => {}, onUsage: () => () => {},
  } as Record<string, unknown>, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
      if (typeof property === "string" && property.startsWith("on")) return () => () => {};
      return (..._args: unknown[]) => Promise.reject(new Error(`Web mode does not support ${String(property)} yet.`));
    },
  }) as unknown as ContextGitBridge;
  window.contextgit = bridge;
  listeners.forEach(callback => callback(status));
  const initialProject = query("project");
  if (initialProject) void open(initialProject).catch((cause) => console.warn("Could not open launch project", cause));
}
