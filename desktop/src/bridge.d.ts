/** Bridge exposed by desktop/electron/preload.ts. */
export interface ContextGitBridge {
  apiBase: string;
  getStatus: () => { status: import("../shared/status").BackendStatus; apiBase: string };
  restartBackend: () => Promise<{ status: import("../shared/status").BackendStatus; apiBase: string }>;
  onStatus: (callback: (status: import("../shared/status").BackendStatus) => void) => () => void;
  ptyStart: (options: {
    id: string;
    command: string;
    cols: number;
    rows: number;
    cwd?: string;
  }) => void;
  ptyWrite: (id: string, data: string) => void;
  ptyResize: (id: string, cols: number, rows: number) => void;
  ptyKill: (id: string) => void;
  ptyPresets: () => Promise<string[]>;
  getWorkspace: () => Promise<import("../shared/workspace").Workspace>;
  chooseWorkspace: () => Promise<import("../shared/workspace").Workspace | null>;
  pickWorkspaceLocation: () => Promise<string | null>;
  createWorkspace: (parent: string, name: string) => Promise<import("../shared/workspace").Workspace>;
  onPtyData: (callback: (id: string, data: string) => void) => () => void;
  onPtyExit: (callback: (id: string, code: number | undefined) => void) => () => void;
}

declare global {
  interface Window {
    contextgit?: ContextGitBridge;
  }
}
