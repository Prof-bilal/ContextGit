import type { BackendStatus } from "../shared/status";
import { projectRuntime, invalidateProjects } from "../shared/projectRuntime";

type TauriGlobals = {
  core?: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
  event?: { listen: (name: string, handler: (event: { payload: unknown }) => void) => Promise<() => void> };
};
type ContextGitBridge = NonNullable<Window["contextgit"]>;

function globals(): TauriGlobals | undefined {
  return (window as Window & { __TAURI__?: TauriGlobals }).__TAURI__;
}

/** Install the compatibility bridge only when the renderer is hosted by Tauri. */
export async function installTauriBridge(): Promise<void> {
  const tauri = globals();
  if (!tauri?.core?.invoke || window.contextgit) return;

  let apiBase = "http://127.0.0.1:8756";
  const apiToken = String(await tauri.core.invoke("backend_token"));
  let status: BackendStatus = { state: "starting", message: "Starting the local ContextGit backend…" };
  const unsupported = (name: string) => Promise.reject(new Error(`Tauri command not migrated yet: ${name}`));
  const noEvents = () => () => { };
  const dataListeners = new Set<(id: string, data: string) => void>();
  const exitListeners = new Set<(id: string, code: number | undefined) => void>();
  const ptyEventsReady = tauri.event ? Promise.all([
    tauri.event.listen("pty-data", event => {
      const payload = event.payload as { id?: unknown; data?: unknown };
      if (typeof payload.id === "string" && typeof payload.data === "string") {
        for (const callback of dataListeners) callback(payload.id, payload.data);
      }
    }),
    tauri.event.listen("pty-exit", event => {
      const payload = event.payload as { id?: unknown; code?: unknown };
      if (typeof payload.id === "string") {
        for (const callback of exitListeners) callback(payload.id, typeof payload.code === "number" ? payload.code : undefined);
      }
    }),
  ]) : Promise.reject(new Error("Tauri terminal events are unavailable."));
  // The launch awaits this promise and reports any subscription failure.
  void ptyEventsReady.catch(() => {});
  const statusListeners = new Set<(next: BackendStatus) => void>();
  const publishStatus = (next: BackendStatus) => {
    const changed = next.state === "ready" && next.apiBase !== apiBase;
    status = next;
    if (status.state === "ready") apiBase = status.apiBase;
    if (changed) invalidateProjects();
    statusListeners.forEach(callback => callback(status));
  };
  let statusTimer: number | undefined;
  const pollStatus = async () => {
    try { publishStatus(await tauri.core!.invoke("backend_status") as BackendStatus); } catch { }
    if (statusListeners.size) statusTimer = window.setTimeout(() => void pollStatus(), 5000);
  };
  const onStatus = (callback: (next: BackendStatus) => void) => {
    const first = statusListeners.size === 0;
    statusListeners.add(callback);
    callback(status);
    if (first) void pollStatus();
    return () => {
      statusListeners.delete(callback);
      if (!statusListeners.size && statusTimer !== undefined) window.clearTimeout(statusTimer);
    };
  };
  void tauri.event?.listen("backend-status", event => publishStatus(event.payload as BackendStatus));
  let projectRevision = -1;
  let selectionSequence = 0;
  let pendingSelection = false;
  let observedWorkspace: import("../shared/workspace").Workspace | null = null;
  const adoptWorkspace = (workspace: import("../shared/workspace").Workspace | null) => {
    if (workspace && (workspace.revision ?? 0) >= (observedWorkspace?.revision ?? -1)) observedWorkspace = workspace;
    if (pendingSelection) return;
    if (workspace && (workspace.revision ?? 0) < projectRevision) return;
    projectRevision = workspace?.revision ?? projectRevision + 1;
    if (projectRuntime.read().path !== (workspace?.path ?? null)) projectRuntime.select(workspace?.path ?? null);
  };
  void tauri.event?.listen("project-changed", event => adoptWorkspace(event.payload as import("../shared/workspace").Workspace | null));
  const baseBridge = {
    // Keep this property live. A backend restart may select a different free
    // port, so consumers must never retain the bootstrap port (8756).
    get apiBase() { return apiBase; },
    apiToken,
    getStatus: () => ({ status, apiBase }),
    refreshBackendStatus: async () => {
      const next = await tauri.core!.invoke("backend_status") as typeof status;
      status = next;
      if (status.state === "ready") apiBase = status.apiBase;
      return { status, apiBase };
    },
    restartBackend: async () => {
      const next = await tauri.core!.invoke("restart_backend");
      status = next as typeof status;
      if (status.state === "ready") apiBase = status.apiBase;
      invalidateProjects();
      return { status, apiBase };
    },
    newWindow: () => tauri.core!.invoke("new_window") as Promise<void>,
    runtimeInfo: () => tauri.core!.invoke("runtime_info") as Promise<import("../shared/runtime").RuntimeInfo>,
    onStatus,
    getUpdateStatus: () => ({ state: "idle", currentVersion: "0.2.0-beta.2", supported: false } as import("../shared/update").UpdateStatus),
    checkForUpdates: () => unsupported("check_for_updates"),
    downloadUpdate: () => unsupported("download_update"),
    installUpdate: () => unsupported("install_update"),
    openUpdateRelease: () => unsupported("open_update_release"),
    onUpdateStatus: noEvents,
  } as unknown as ContextGitBridge;
  const migrated = {
    getWorkspace: async () => {
      const next = await tauri.core!.invoke("get_workspace") as import("../shared/workspace").Workspace | null;
      adoptWorkspace(next);
      return next;
    },
    listProjects: () => tauri.core!.invoke("list_projects"),
    useProject: async (path: string) => {
      const ticket = ++selectionSequence;
      pendingSelection = true;
      const previous = projectRuntime.read().path;
      projectRuntime.select(path);
      try {
        const next = await tauri.core!.invoke("use_project", { path }) as import("../shared/workspace").Workspace;
        if (ticket === selectionSequence) {
          pendingSelection = false;
          adoptWorkspace((observedWorkspace?.revision ?? -1) > (next.revision ?? 0) ? observedWorkspace : next);
        }
        return next;
      } catch (cause) {
        if (ticket === selectionSequence) {
          pendingSelection = false;
          if (projectRuntime.read().path === path) projectRuntime.select(previous);
        }
        throw cause;
      }
    },
    forgetProject: async (path: string) => {
      const next = await tauri.core!.invoke("forget_project", { path });
      adoptWorkspace(await tauri.core!.invoke("get_workspace") as import("../shared/workspace").Workspace | null);
      return next;
    },
    chooseWorkspace: async () => {
      const next = await tauri.core!.invoke("choose_workspace");
      if (next) adoptWorkspace(next as import("../shared/workspace").Workspace);
      return next;
    },
    pickWorkspaceLocation: () => tauri.core!.invoke("pick_workspace_location"),
    createWorkspace: async (parent: string, name: string) => {
      const next = await tauri.core!.invoke("create_workspace", { parent, name });
      adoptWorkspace(next as import("../shared/workspace").Workspace);
      return next;
    },
    ptyStart: async (options: Parameters<ContextGitBridge["ptyStart"]>[0]) => {
      await ptyEventsReady;
      await tauri.core!.invoke("pty_start", { options });
    },
    ptyWrite: (id: string, data: string) => { void tauri.core!.invoke("pty_write", { id, data }); },
    ptyResize: (id: string, cols: number, rows: number) => { void tauri.core!.invoke("pty_resize", { id, cols, rows }); },
    ptyKill: (id: string) => { void tauri.core!.invoke("pty_kill", { id }); },
    ptyPresets: () => tauri.core!.invoke("pty_presets") as Promise<string[]>,
    harnessCheck: (id: string) => tauri.core!.invoke("harness_check", { id }) as Promise<import("../shared/harnesses").HarnessCheck>,
    harnessInstall: (id: string) => tauri.core!.invoke("harness_install", { id }) as Promise<{ started: boolean }>,
    onHarnessProgress: (callback: (progress: import("../shared/harnesses").HarnessInstallEvent) => void) => {
      let active = true;
      void tauri.event?.listen("harness-progress", event => {
        if (active) callback(event.payload as import("../shared/harnesses").HarnessInstallEvent);
      });
      return () => { active = false; };
    },
    onPtyData: (callback: (id: string, data: string) => void) => {
      dataListeners.add(callback);
      return () => { dataListeners.delete(callback); };
    },
    onPtyExit: (callback: (id: string, code: number | undefined) => void) => {
      exitListeners.add(callback);
      return () => { exitListeners.delete(callback); };
    },
    saveFile: async (options: { defaultName: string; data: ArrayBuffer }) => tauri.core!.invoke("save_file", {
      defaultName: options.defaultName,
      data: Array.from(new Uint8Array(options.data)),
    }) as Promise<string | null>,
  };
  // Keep the renderer stable while individual Tauri services are ported. A
  // missing operation becomes an actionable rejected promise instead of an
  // undefined-method crash during feature mounting.
  const bridge = new Proxy({ ...baseBridge, ...migrated } as ContextGitBridge, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
      if (typeof property !== "string") return undefined;
      if (property === "assetUrl") return (id: string) => `ctxasset://a/${encodeURIComponent(id)}`;
      if (["ptyStart", "ptyWrite", "ptyResize", "ptyKill", "usageActivity", "harnessCancel", "viewSetBounds", "viewSetVisible"].includes(property)) {
        return () => { };
      }
      if (property.startsWith("on")) return noEvents;
      return (..._args: unknown[]) => unsupported(property);
    },
  });
  Object.defineProperty(bridge, "apiBase", {
    enumerable: true,
    configurable: false,
    get: () => apiBase,
  });

  void tauri.core.invoke("backend_status").then(value => {
    status = value as typeof status;
    if (status.state === "ready") apiBase = status.apiBase;
  }).catch(() => {
    status = { state: "error", message: "Tauri backend status command failed." };
  });
  window.contextgit = bridge;
}
