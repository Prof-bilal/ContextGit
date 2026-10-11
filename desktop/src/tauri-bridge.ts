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

  const apiBase = "http://127.0.0.1:8756";
  let status: BackendStatus = { state: "ready", apiBase };
  const unsupported = (name: string) => Promise.reject(new Error(`Tauri command not migrated yet: ${name}`));
  const noEvents = () => () => { };
  const onStatus = (callback: (next: BackendStatus) => void) => {
    let active = true;
    const poll = async () => {
      try {
        status = await tauri.core!.invoke("backend_status") as typeof status;
        callback(status);
      } catch {
        // The renderer will keep its last known status until the next poll.
      }
      if (active) window.setTimeout(() => void poll(), 1000);
    };
    void poll();
    return () => { active = false; };
  };
  const baseBridge = {
    apiBase,
    apiToken: "tauri-local-token",
    getStatus: () => ({ status, apiBase }),
    restartBackend: async () => {
      const next = await tauri.core!.invoke("restart_backend");
      status = next as typeof status;
      return { status, apiBase };
    },
    runtimeInfo: () => tauri.core!.invoke("runtime_info") as Promise<import("../shared/runtime").RuntimeInfo>,
    onStatus,
    getUpdateStatus: () => ({ state: "idle", currentVersion: "0.1.0", supported: false } as import("../shared/update").UpdateStatus),
    checkForUpdates: () => unsupported("check_for_updates"),
    downloadUpdate: () => unsupported("download_update"),
    installUpdate: () => unsupported("install_update"),
    openUpdateRelease: () => unsupported("open_update_release"),
    onUpdateStatus: noEvents,
  } as unknown as ContextGitBridge;
  // Keep the renderer stable while individual Tauri services are ported. A
  // missing operation becomes an actionable rejected promise instead of an
  // undefined-method crash during feature mounting.
  const bridge = new Proxy(baseBridge, {
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
  }).catch(() => {
    status = { state: "error", message: "Tauri backend status command failed." };
  });
  window.contextgit = bridge;
}
