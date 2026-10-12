import type { BackendStatus } from "../shared/status";

type TauriGlobals = {
  core?: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
  event?: { listen: (name: string, handler: (event: { payload: unknown }) => void) => Promise<() => void> };
};
type ContextGitBridge = NonNullable<Window["contextgit"]>;

function globals(): TauriGlobals | undefined {
  return (window as Window & { __TAURI__?: TauriGlobals }).__TAURI__;
}

/** Install the compatibility bridge only when the renderer is hosted by Tauri. */
export function installTauriBridge(): void {
  const tauri = globals();
  if (!tauri?.core?.invoke || window.contextgit) return;

  let apiBase = "http://127.0.0.1:8756";
  let status: BackendStatus = { state: "starting", message: "Starting the local ContextGit backend…" };
  const unsupported = (name: string) => Promise.reject(new Error(`Tauri command not migrated yet: ${name}`));
  const noEvents = () => () => { };
  const onStatus = (callback: (next: BackendStatus) => void) => {
    let active = true;
    let stopEvent: (() => void) | undefined;
    void tauri.event?.listen("backend-status", event => {
      if (!active) return;
      status = event.payload as BackendStatus;
      if (status.state === "ready") apiBase = status.apiBase;
      callback(status);
    }).then(unlisten => { stopEvent = unlisten; });
    const poll = async () => {
      try {
        status = await tauri.core!.invoke("backend_status") as typeof status;
        if (status.state === "ready") apiBase = status.apiBase;
        callback(status);
      } catch {
        // The renderer will keep its last known status until the next poll.
      }
      if (active) window.setTimeout(() => void poll(), 1000);
    };
    void poll();
    return () => { active = false; stopEvent?.(); };
  };
  const baseBridge = {
    apiBase,
    apiToken: "tauri-local-token",
    getStatus: () => ({ status, apiBase }),
    restartBackend: async () => {
      const next = await tauri.core!.invoke("restart_backend");
      status = next as typeof status;
      if (status.state === "ready") apiBase = status.apiBase;
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
    getWorkspace: () => tauri.core!.invoke("get_workspace"),
    listProjects: () => tauri.core!.invoke("list_projects"),
    useProject: async (path: string) => {
      const next = await tauri.core!.invoke("use_project", { path });
      await tauri.core!.invoke("restart_backend");
      return next;
    },
    forgetProject: async (path: string) => {
      const next = await tauri.core!.invoke("forget_project", { path });
      await tauri.core!.invoke("restart_backend");
      return next;
    },
    chooseWorkspace: async () => {
      const next = await tauri.core!.invoke("choose_workspace");
      if (next) await tauri.core!.invoke("restart_backend");
      return next;
    },
    pickWorkspaceLocation: () => tauri.core!.invoke("pick_workspace_location"),
    createWorkspace: async (parent: string, name: string) => {
      const next = await tauri.core!.invoke("create_workspace", { parent, name });
      await tauri.core!.invoke("restart_backend");
      return next;
    },
    ptyStart: (options: Parameters<ContextGitBridge["ptyStart"]>[0]) => {
      void tauri.core!.invoke("pty_start", { options });
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
      let active = true;
      void tauri.event?.listen("pty-data", event => {
        if (!active) return;
        const payload = event.payload as { id?: unknown; data?: unknown };
        if (typeof payload.id === "string" && typeof payload.data === "string") callback(payload.id, payload.data);
      });
      return () => { active = false; };
    },
    onPtyExit: (callback: (id: string, code: number | undefined) => void) => {
      let active = true;
      void tauri.event?.listen("pty-exit", event => {
        if (!active) return;
        const payload = event.payload as { id?: unknown; code?: unknown };
        if (typeof payload.id === "string") callback(payload.id, typeof payload.code === "number" ? payload.code : undefined);
      });
      return () => { active = false; };
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

  void tauri.core.invoke("backend_status").then(value => {
    status = value as typeof status;
    if (status.state === "ready") apiBase = status.apiBase;
  }).catch(() => {
    status = { state: "error", message: "Tauri backend status command failed." };
  });
  window.contextgit = bridge;
}
