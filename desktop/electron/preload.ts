/** Preload: exposes the backend status channel to the renderer (sandbox-safe). */
import { contextBridge, ipcRenderer } from "electron";

import type { HarnessCheck, HarnessInstallEvent } from "../shared/harnesses";
import type { BackendStatus } from "../shared/status";
import type { Workspace } from "../shared/workspace";

const initial = ipcRenderer.sendSync("ctx:status-sync") as {
  status: BackendStatus;
  apiBase: string;
};

contextBridge.exposeInMainWorld("contextgit", {
  apiBase: initial.apiBase,
  getStatus: () => ipcRenderer.sendSync("ctx:status-sync") as { status: BackendStatus; apiBase: string },
  restartBackend: () => ipcRenderer.invoke("ctx:restart-backend") as Promise<{ status: BackendStatus; apiBase: string }>,
  onStatus: (callback: (status: BackendStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, next: BackendStatus) => callback(next);
    ipcRenderer.on("ctx:status", listener);
    return () => ipcRenderer.removeListener("ctx:status", listener);
  },
  // ---------- PTY terminals ----------
  ptyStart: (options: {
    id: string;
    command: string;
    cols: number;
    rows: number;
    cwd?: string;
    input?: string;
    env?: Record<string, string>;
  }) => {
    ipcRenderer.send("ctx:pty-start", options);
  },
  ptyWrite: (id: string, data: string) => ipcRenderer.send("ctx:pty-write", id, data),
  ptyResize: (id: string, cols: number, rows: number) =>
    ipcRenderer.send("ctx:pty-resize", id, cols, rows),
  ptyKill: (id: string) => ipcRenderer.send("ctx:pty-kill", id),
  ptyPresets: () => ipcRenderer.invoke("ctx:pty-presets") as Promise<string[]>,
  // ---------- Harness detection + install ----------
  harnessCheck: (id: string) => ipcRenderer.invoke("ctx:harness-check", id) as Promise<HarnessCheck>,
  harnessInstall: (id: string) =>
    ipcRenderer.invoke("ctx:harness-install", id) as Promise<{ started: boolean }>,
  harnessCancel: (id: string) => ipcRenderer.send("ctx:harness-cancel", id),
  onHarnessProgress: (callback: (progress: HarnessInstallEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: HarnessInstallEvent) =>
      callback(progress);
    ipcRenderer.on("ctx:harness-progress", listener);
    return () => ipcRenderer.removeListener("ctx:harness-progress", listener);
  },
  // ---------- Project folders (remembered projects + active) ----------
  getWorkspace: () => ipcRenderer.invoke("ctx:workspace-get") as Promise<Workspace | null>,
  listProjects: () => ipcRenderer.invoke("ctx:projects-list") as Promise<Workspace[]>,
  useProject: (target: string) =>
    ipcRenderer.invoke("ctx:projects-use", target) as Promise<Workspace | null>,
  forgetProject: (target: string) =>
    ipcRenderer.invoke("ctx:projects-forget", target) as Promise<Workspace[]>,
  chooseWorkspace: () => ipcRenderer.invoke("ctx:workspace-choose") as Promise<Workspace | null>,
  pickWorkspaceLocation: () => ipcRenderer.invoke("ctx:workspace-pick") as Promise<string | null>,
  createWorkspace: (parent: string, name: string) =>
    ipcRenderer.invoke("ctx:workspace-create", { parent, name }) as Promise<Workspace>,
  // ---------- File save (document export) ----------
  saveFile: (options: { defaultName: string; data: ArrayBuffer }) =>
    ipcRenderer.invoke("ctx:save-file", options) as Promise<string | null>,
  // ---------- Assets tab (app-level asset library) ----------
  assetsCatalog: () =>
    ipcRenderer.invoke("ctx:assets-catalog") as Promise<import("../shared/assets").AssetCatalog>,
  assetsImport: () =>
    ipcRenderer.invoke("ctx:assets-import") as Promise<
      import("../shared/assets").AssetImportResult
    >,
  assetsImportFolder: () =>
    ipcRenderer.invoke("ctx:assets-import-folder") as Promise<
      import("../shared/assets").AssetImportResult
    >,
  assetsCreateFolder: (folder: string) =>
    ipcRenderer.invoke("ctx:assets-create-folder", folder) as Promise<string>,
  assetsMove: (ids: string[], folder: string) =>
    ipcRenderer.invoke("ctx:assets-move", ids, folder) as Promise<number>,
  assetsUpdate: (id: string, patch: import("../shared/assets").AssetPatch) =>
    ipcRenderer.invoke("ctx:assets-update", id, patch) as Promise<
      import("../shared/assets").Asset | null
    >,
  assetsDelete: (id: string) =>
    ipcRenderer.invoke("ctx:assets-delete", id) as Promise<boolean>,
  assetsApply: (actions: import("../shared/assets").AgentAction[]) =>
    ipcRenderer.invoke("ctx:assets-apply", actions) as Promise<
      import("../shared/assets").AgentActionResult[]
    >,
  assetsReveal: (id: string) =>
    ipcRenderer.invoke("ctx:assets-reveal", id) as Promise<boolean>,
  /** Stable URL for an asset's bytes (served through the ctxasset:// scheme). */
  assetUrl: (id: string) => `ctxasset://a/${encodeURIComponent(id)}`,
  // ---------- Browser tab (in-app WebContentsView) ----------
  viewCreate: (id: string, url: string) =>
    ipcRenderer.invoke("ctx:view-create", id, url) as Promise<
      import("../shared/browser").ViewCreateResult
    >,
  viewSetBounds: (id: string, bounds: import("../shared/browser").ViewBounds) =>
    ipcRenderer.send("ctx:view-set-bounds", id, bounds),
  viewSetVisible: (id: string, visible: boolean) =>
    ipcRenderer.send("ctx:view-set-visible", id, visible),
  viewLoad: (id: string, url: string) =>
    ipcRenderer.invoke("ctx:view-load", id, url) as Promise<
      import("../shared/browser").ViewCreateResult
    >,
  viewBack: (id: string) => ipcRenderer.send("ctx:view-back", id),
  viewForward: (id: string) => ipcRenderer.send("ctx:view-forward", id),
  viewReload: (id: string) => ipcRenderer.send("ctx:view-reload", id),
  viewDevtools: (id: string) => ipcRenderer.send("ctx:view-devtools", id),
  viewDestroy: (id: string) => ipcRenderer.send("ctx:view-destroy", id),
  onViewEvent: (callback: (event: import("../shared/browser").ViewEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, next: import("../shared/browser").ViewEvent) =>
      callback(next);
    ipcRenderer.on("ctx:view-event", listener);
    return () => ipcRenderer.removeListener("ctx:view-event", listener);
  },
  // ---------- Editor tab (embedded VS Code sidecar) ----------
  editorStatus: () =>
    ipcRenderer.invoke("ctx:editor-status") as Promise<import("../shared/editor").EditorStatus>,
  editorStart: () =>
    ipcRenderer.invoke("ctx:editor-start") as Promise<import("../shared/editor").EditorStartResult>,
  editorStop: () =>
    ipcRenderer.invoke("ctx:editor-stop") as Promise<import("../shared/editor").EditorStatus>,
  editorSelectionGet: () =>
    ipcRenderer.invoke("ctx:editor-selection-get") as Promise<{ providerId: string; model: string }>,
  editorSelectionSet: (selection: { providerId?: string; model?: string }) =>
    ipcRenderer.invoke("ctx:editor-selection-set", selection) as Promise<{
      providerId: string;
      model: string;
    }>,
  onPtyData: (callback: (id: string, data: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, id: string, data: string) => callback(id, data);
    ipcRenderer.on("ctx:pty-data", listener);
    return () => ipcRenderer.removeListener("ctx:pty-data", listener);
  },
  onPtyExit: (callback: (id: string, code: number | undefined) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, id: string, code: number | undefined) =>
      callback(id, code);
    ipcRenderer.on("ctx:pty-exit", listener);
    return () => ipcRenderer.removeListener("ctx:pty-exit", listener);
  },
});
