/** Preload: exposes the backend status channel to the renderer (sandbox-safe). */
import { contextBridge, ipcRenderer } from "electron";

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
  }) => {
    ipcRenderer.send("ctx:pty-start", options);
  },
  ptyWrite: (id: string, data: string) => ipcRenderer.send("ctx:pty-write", id, data),
  ptyResize: (id: string, cols: number, rows: number) =>
    ipcRenderer.send("ctx:pty-resize", id, cols, rows),
  ptyKill: (id: string) => ipcRenderer.send("ctx:pty-kill", id),
  ptyPresets: () => ipcRenderer.invoke("ctx:pty-presets") as Promise<string[]>,
  // ---------- Project folder ----------
  getWorkspace: () => ipcRenderer.invoke("ctx:workspace-get") as Promise<Workspace>,
  chooseWorkspace: () => ipcRenderer.invoke("ctx:workspace-choose") as Promise<Workspace | null>,
  pickWorkspaceLocation: () => ipcRenderer.invoke("ctx:workspace-pick") as Promise<string | null>,
  createWorkspace: (parent: string, name: string) =>
    ipcRenderer.invoke("ctx:workspace-create", { parent, name }) as Promise<Workspace>,
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
