/** Bridge exposed by desktop/electron/preload.ts. */
export interface ContextGitBridge {
  apiBase: string;
  apiToken: string;
  getStatus: () => { status: import("../shared/status").BackendStatus; apiBase: string };
  restartBackend: () => Promise<{ status: import("../shared/status").BackendStatus; apiBase: string }>;
  runtimeInfo: () => Promise<import("../shared/runtime").RuntimeInfo>;
  onStatus: (callback: (status: import("../shared/status").BackendStatus) => void) => () => void;
  getUpdateStatus: () => import("../shared/update").UpdateStatus;
  checkForUpdates: () => Promise<import("../shared/update").UpdateStatus>;
  downloadUpdate: () => Promise<import("../shared/update").UpdateStatus>;
  installUpdate: () => Promise<import("../shared/update").UpdateStatus>;
  openUpdateRelease: () => Promise<void>;
  onUpdateStatus: (callback: (status: import("../shared/update").UpdateStatus) => void) => () => void;
  ptyStart: (options: {
    id: string;
    command: string;
    sessionId?: string;
    cols: number;
    rows: number;
    cwd?: string;
    input?: string;
    env?: Record<string, string>;
  }) => void;
  ptyWrite: (id: string, data: string) => void;
  ptyResize: (id: string, cols: number, rows: number) => void;
  ptyKill: (id: string) => void;
  harnessUsage: (harness: string, sessionId?: string, refresh?: boolean) => Promise<import("../../lib/api").HarnessLimits>;
  usageActivity: (visible: boolean, integrationActive?: boolean) => void;
  onUsage: (callback: (value: import("../../lib/api").HarnessLimits) => void) => () => void;
  ptyPresets: () => Promise<string[]>;
  harnessCheck: (id: string) => Promise<import("../shared/harnesses").HarnessCheck>;
  harnessInstall: (id: string) => Promise<{ started: boolean }>;
  harnessCancel: (id: string) => void;
  onHarnessProgress: (
    callback: (progress: import("../shared/harnesses").HarnessInstallEvent) => void,
  ) => () => void;
  getWorkspace: () => Promise<import("../shared/workspace").Workspace | null>;
  /** Every remembered project folder, and the active one. */
  listProjects: () => Promise<import("../shared/workspace").Workspace[]>;
  useProject: (path: string) => Promise<import("../shared/workspace").Workspace | null>;
  forgetProject: (path: string) => Promise<import("../shared/workspace").Workspace[]>;
  chooseWorkspace: () => Promise<import("../shared/workspace").Workspace | null>;
  pickWorkspaceLocation: () => Promise<string | null>;
  createWorkspace: (parent: string, name: string) => Promise<import("../shared/workspace").Workspace>;
  /** Native Save dialog; returns the written path or null when cancelled. */
  saveFile: (options: { defaultName: string; data: ArrayBuffer }) => Promise<string | null>;
  /** Assets tab: the app-level asset library (files live under the app's userData). */
  assetsCatalog: () => Promise<import("../shared/assets").AssetCatalog>;
  assetsImport: () => Promise<import("../shared/assets").AssetImportResult>;
  assetsImportFolder: () => Promise<import("../shared/assets").AssetImportResult>;
  assetsCreateFolder: (folder: string) => Promise<string>;
  assetsMove: (ids: string[], folder: string) => Promise<number>;
  assetsUpdate: (
    id: string,
    patch: import("../shared/assets").AssetPatch,
  ) => Promise<import("../shared/assets").Asset | null>;
  assetsDelete: (id: string) => Promise<boolean>;
  /** Execute an asset-agent plan (rename/move/folder/tag/note/delete). */
  assetsApply: (
    actions: import("../shared/assets").AgentAction[],
  ) => Promise<import("../shared/assets").AgentActionResult[]>;
  assetsReveal: (id: string) => Promise<boolean>;
  /** Stable URL for an asset's bytes (served via the ctxasset:// scheme). */
  assetUrl: (id: string) => string;
  /** Browser tab: a main-process WebContentsView positioned over the panel. */
  viewCreate: (id: string, url: string) => Promise<import("../shared/browser").ViewCreateResult>;
  viewSetBounds: (id: string, bounds: import("../shared/browser").ViewBounds) => void;
  viewSetVisible: (id: string, visible: boolean) => void;
  viewLoad: (id: string, url: string) => Promise<import("../shared/browser").ViewCreateResult>;
  viewBack: (id: string) => void;
  viewForward: (id: string) => void;
  viewReload: (id: string) => void;
  viewDevtools: (id: string) => void;
  viewDestroy: (id: string) => void;
  viewFind: (id: string, text: string) => void;
  viewFindStop: (id: string) => void;
  viewSetZoom: (id: string, level: number) => void;
  onViewEvent: (callback: (event: import("../shared/browser").ViewEvent) => void) => () => void;
  onPtyData: (callback: (id: string, data: string) => void) => () => void;
  onPtyExit: (callback: (id: string, code: number | undefined) => void) => () => void;
}

declare global {
  interface Window {
    contextgit?: ContextGitBridge;
  }
}
