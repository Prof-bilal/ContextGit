/**
 * Electron main process: spawns the local ContextGit API (uvicorn in dev,
 * PyInstaller binary when packaged), health-gates the window on it, and
 * pushes backend status to the renderer.
 */
import { app, BrowserWindow, dialog, ipcMain, net as enet, protocol, shell } from "electron";
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { BackendRestart, launchBackend, terminateBackend } from "./backendProcess";
import { PTY_PRESETS, PtyManager } from "./pty";
import { UsageManager } from "./usage";
import { prepareOpenCodeCapture } from "./conversationCapture";
import { repositoryId, validateBackend } from "./backendHealth";
import {
  augmentedPath,
  cancelInstall,
  checkHarness,
  installHarness,
  killInstalls,
} from "./harness";
import { HARNESS_BY_ID } from "../shared/harnesses";
import type { BackendStatus } from "../shared/status";
import type { Workspace } from "../shared/workspace";
import { AssetLibrary } from "./library";
import { ViewManager } from "./viewmanager";
import type { ViewBounds } from "../shared/browser";
import type { AssetPatch } from "../shared/assets";
import type { UpdateStatus } from "../shared/update";
import { UPDATE_RELEASE_URL } from "../shared/update";
import { ContextGitUpdater } from "./updater";

const isDev = !app.isPackaged;
// Keep local development state separate from an installed release. Without
// this, `npm run dev` and the packaged app share projects.json, assets, usage,
// and other userData, making a folder opened in development appear in the
// downloaded app.
if (isDev) app.setPath("userData", path.join(app.getPath("appData"), "ContextGit-dev"));
const repoRoot = path.resolve(app.getAppPath(), "..");
const backendPort = Number(process.env.CONTEXTGIT_PORT ?? 8756);
const apiBase = `http://127.0.0.1:${backendPort}`;
const apiToken = randomBytes(32).toString("hex");

/**
 * Asset bytes (thumbnails, previews, video) are served to the renderer through
 * this scheme — the renderer only ever names an asset id, never a path.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: "ctxasset",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true },
  },
]);

let backend: ChildProcess | null = null;
let status: BackendStatus = { state: "starting" };
let mainWindow: BrowserWindow | null = null;
const updater = new ContextGitUpdater({
  currentVersion: app.getVersion(),
  packaged: app.isPackaged,
  statusSink: (next: UpdateStatus) => mainWindow?.webContents.send("ctx:update-status", next),
});
updater.initialize();

function setStatus(next: BackendStatus): void {
  status = next;
  mainWindow?.webContents.send("ctx:status", next);
}

function getPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

let backendMonitor: ReturnType<typeof setInterval> | null = null;
let probingBackend = false;
let backendGeneration = 0;
function backendRepoPath(): string {
  const active = currentWorkspace();
  if (active) return path.join(active.path, ".contextgit");
  return process.env.CONTEXTGIT_REPO
    ? path.resolve(process.env.CONTEXTGIT_REPO)
    : path.join(app.getPath("userData"), "contextgit");
}
function rendererOrigin(): string {
  return process.env.VITE_DEV_SERVER_URL ? new URL(process.env.VITE_DEV_SERVER_URL).origin : "null";
}
async function probeBackend(generation = backendGeneration): Promise<void> {
  const identity = await validateBackend(apiBase, repositoryId(backendRepoPath()), rendererOrigin(), fetch, apiToken);
  if (generation !== backendGeneration || !backend) return;
  if (status.state === "ready" && status.repoId === identity.repoId && status.instanceId === identity.instanceId) return;
  setStatus({ state: "ready", apiBase, ...identity });
}
function startBackendMonitor(): void {
  if (backendMonitor) clearInterval(backendMonitor);
  backendMonitor = setInterval(() => {
    if (probingBackend || !backend) return;
    probingBackend = true;
    const generation = backendGeneration;
    void probeBackend(generation).catch((cause) => {
      if (generation !== backendGeneration || !backend) return;
      const message = cause instanceof Error ? cause.message : "Backend connection lost.";
      if (status.state !== "error" || status.message !== message) setStatus({ state: "error", message });
    }).finally(() => { if (generation === backendGeneration) probingBackend = false; });
  }, 5000);
}

async function spawnBackend(): Promise<void> {
  const generation = backendGeneration;
  const env = {
    ...process.env,
    CONTEXTGIT_HOST: "127.0.0.1",
    CONTEXTGIT_PORT: String(backendPort),
    CONTEXTGIT_API_TOKEN: apiToken,
    CONTEXTGIT_REPO: backendRepoPath(),
    // Renderer origin: only the dev server needs an explicit web origin;
    // packaged file:// requests are protected by the launch token.
    CONTEXTGIT_CORS_ORIGINS: [...new Set([
      rendererOrigin(),
      ...(process.env.CONTEXTGIT_CORS_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173")
        .split(",").map(origin => origin.trim()).filter(Boolean),
    ])].join(","),
  };
  const venvPython = path.join(repoRoot, process.platform === "win32" ? ".venv\\Scripts\\python.exe" : ".venv/bin/python");
  const devPython = fs.existsSync(venvPython)
    ? venvPython
    : process.platform === "win32" ? "python" : process.env.PYTHON ?? "python3";
  const binary = isDev
    ? devPython
    : path.join(process.resourcesPath, "backend", process.platform === "win32" ? "contextgit-api.exe" : "contextgit-api");
  const args = isDev
    ? ["-m", "uvicorn", "contextgit.api.main:app", "--host", "127.0.0.1", "--port", String(backendPort)]
    : [];
  if (isDev && !(await getPortFree(backendPort))) {
    setStatus({ state: "error", message: `Port ${backendPort} is occupied. Stop the existing backend or choose CONTEXTGIT_PORT; the desktop requires its own authenticated backend.` });
    return;
  }
  if (generation !== backendGeneration) return;
  const child = launchBackend(binary, args, {
    cwd: isDev ? repoRoot : process.resourcesPath,
    env,
  });
  backend = child;
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
    if (isDev) process.stderr.write(chunk);
  });
  child.on("error", (cause: Error) => {
    if (generation !== backendGeneration || backend !== child) return;
    // `spawn` emits this asynchronously (e.g. ENOENT when the binary is missing).
    // Without a handler Node rethrows it, crashing the main process instead of
    // showing the "Backend failed" screen.
    setStatus({
      state: "error",
      message: `Backend could not start (${cause.message}). ${stderr}`,
    });
    backend = null;
  });
  child.on("exit", (code) => {
    if (generation !== backendGeneration || backend !== child) return;
    if (status.state === "ready") {
      setStatus({ state: "error", message: `Backend exited (code ${code}). ${stderr}` });
    } else {
      setStatus({ state: "error", message: `Backend failed to start. ${stderr}` });
    }
    backend = null;
  });
  await waitForHealth(generation);
  if (generation === backendGeneration && backend === child && status.state === "ready") startBackendMonitor();
}

async function waitForHealth(generation: number): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError = "No response";
  while (Date.now() < deadline) {
    if (!backend || generation !== backendGeneration) return;
    try {
      await probeBackend(generation);
      return;
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : "No response";
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (generation !== backendGeneration || !backend) return;
  setStatus({ state: "error", message: `Backend failed on ${apiBase}: ${lastError}` });
}

let backendStop: Promise<void> | null = null;
const backendRestart = new BackendRestart();
function stopBackend(): Promise<void> {
  if (backendStop) return backendStop;
  backendGeneration++;
  if (backendMonitor) clearInterval(backendMonitor);
  backendMonitor = null;
  probingBackend = false;
  const child = backend;
  if (!child) return Promise.resolve();
  backendStop = terminateBackend(child).then(() => {
    if (backend === child) backend = null;
  }).finally(() => { backendStop = null; });
  return backendStop;
}

async function restartBackendForActiveProject(): Promise<void> {
  await backendRestart.run(async () => {
    setStatus({ state: "starting" });
    try {
      await stopBackend();
      await spawnBackend();
    } catch (cause) {
      setStatus({
        state: "error",
        message: cause instanceof Error ? cause.message : "Backend restart failed.",
      });
    }
  });
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#191612",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const rendererOrigin = process.env.VITE_DEV_SERVER_URL;
  mainWindow.webContents.on("will-navigate", (event, url) => {
    let allowed = false;
    try {
      const target = new URL(url);
      if (rendererOrigin) {
        allowed = target.origin === new URL(rendererOrigin).origin;
      } else {
        allowed = target.protocol === "file:" &&
          path.resolve(decodeURIComponent(target.pathname)) ===
            path.resolve(app.getAppPath(), "dist", "index.html");
      }
    } catch {
      allowed = false;
    }
    if (!allowed) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const scheme = new URL(url).protocol;
      if (scheme === "http:" || scheme === "https:") void shell.openExternal(url);
    } catch {
      // Invalid and custom schemes are never handed to the operating system.
    }
    return { action: "deny" };
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  if (process.env.CONTEXTGIT_SMOKE) {
    mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
      console.log("SMOKE_CONSOLE", level, `${sourceId}:${line}`, message);
    });
    mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
      console.log("SMOKE_LOADFAIL", code, description, url);
    });
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    try {
      await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    } catch (error) {
      // A fast reload can abort the initial load; the backend must still start.
      console.error("Initial window load was interrupted:", error);
    }
  } else {
    try {
      await mainWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
    } catch (error) {
      console.error("Initial window load was interrupted:", error);
    }
  }
}

ipcMain.on("ctx:status-sync", (event) => {
  event.returnValue = { status, apiBase, apiToken };
});

ipcMain.on("ctx:update-status-sync", (event) => {
  event.returnValue = updater.getStatus();
});
ipcMain.handle("ctx:update-check", () => updater.check(true));
ipcMain.handle("ctx:update-download", () => updater.download());
ipcMain.handle("ctx:update-install", () => updater.install());
ipcMain.handle("ctx:update-open-release", () => shell.openExternal(UPDATE_RELEASE_URL));

ipcMain.handle("ctx:runtime-info", () => ({
  platform: process.platform,
  arch: process.arch,
  shell: process.env.ComSpec ?? process.env.SHELL ?? (process.platform === "win32" ? "powershell.exe" : "/bin/sh"),
}));

// ---------- Projects (the folders the user works in) ----------

/**
 * Every folder the user has opened, plus which one is active. New terminals and
 * agents start in the active project; all of them are remembered so the sidebar
 * can switch between projects. `CONTEXTGIT_WORKDIR`, when set, is a hard
 * single-project override (used by tests/scripts).
 */
interface ProjectStore {
  active: string | null;
  paths: string[];
}

function projectsFile(): string {
  return path.join(app.getPath("userData"), "projects.json");
}

/** Legacy single-workspace file, migrated into the store on first read. */
function workspaceFile(): string {
  return path.join(app.getPath("userData"), "workspace.json");
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function toWorkspace(target: string): Workspace {
  const resolved = path.resolve(target);
  return { path: resolved, name: path.basename(resolved) || resolved, parent: path.dirname(resolved) };
}

function readStore(): ProjectStore {
  const override = process.env.CONTEXTGIT_WORKDIR;
  if (override && isDirectory(override)) {
    const resolved = path.resolve(override);
    return { active: resolved, paths: [resolved] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(projectsFile(), "utf8")) as {
      active?: unknown;
      paths?: unknown;
    };
    const paths = Array.isArray(parsed.paths)
      ? parsed.paths.filter((entry): entry is string => typeof entry === "string" && isDirectory(entry))
      : [];
    if (paths.length > 0) {
      const active =
        typeof parsed.active === "string" && paths.includes(parsed.active) ? parsed.active : paths[0];
      return { active, paths };
    }
  } catch {
    // no projects store yet
  }
  // Migrate a legacy single workspace.json into the list.
  try {
    const legacy = JSON.parse(fs.readFileSync(workspaceFile(), "utf8")) as { path?: unknown };
    if (typeof legacy.path === "string" && isDirectory(legacy.path)) {
      const resolved = path.resolve(legacy.path);
      return { active: resolved, paths: [resolved] };
    }
  } catch {
    // none
  }
  // First run: no folder yet. The Code tab prompts the user to choose one
  // instead of defaulting to the app's own bundle directory.
  return { active: null, paths: [] };
}

let store: ProjectStore | null = null;

function projectStore(): ProjectStore {
  if (!store) store = readStore();
  return store;
}

function saveStore(): void {
  try {
    fs.mkdirSync(path.dirname(projectsFile()), { recursive: true });
    fs.writeFileSync(projectsFile(), `${JSON.stringify(projectStore(), null, 2)}\n`);
  } catch {
    // persistence is best-effort; the in-memory value still applies
  }
}

function listProjects(): Workspace[] {
  return projectStore().paths.map(toWorkspace);
}

function currentWorkspace(): Workspace | null {
  const active = projectStore().active;
  return active ? toWorkspace(active) : null;
}

/** Make an existing folder active, adding it to the list if it's new. */
function useProject(target: string): Workspace {
  const resolved = path.resolve(target);
  const state = projectStore();
  if (!state.paths.includes(resolved)) state.paths.push(resolved);
  state.active = resolved;
  saveStore();
  return toWorkspace(resolved);
}

/** Drop a folder from the list; its runs and commits are untouched. */
function forgetProject(target: string): Workspace[] {
  const resolved = path.resolve(target);
  const state = projectStore();
  state.paths = state.paths.filter((entry) => entry !== resolved);
  if (state.active === resolved) state.active = state.paths[0] ?? null;
  saveStore();
  return listProjects();
}

/** Native folder picker. `createDirectory` adds the dialog's "New Folder" button. */
function showFolderDialog(title: string): Promise<Electron.OpenDialogReturnValue> {
  const options: Electron.OpenDialogOptions = {
    title,
    buttonLabel: "Use this folder",
    defaultPath: currentWorkspace()?.path ?? app.getPath("home"),
    properties: ["openDirectory", "createDirectory"],
  };
  return mainWindow ? dialog.showOpenDialog(mainWindow, options) : dialog.showOpenDialog(options);
}

ipcMain.handle("ctx:workspace-get", () => currentWorkspace());
ipcMain.handle("ctx:projects-list", () => listProjects());

ipcMain.handle("ctx:projects-use", async (_event, target: string) => {
  const next = isDirectory(target) ? useProject(target) : currentWorkspace();
  if (next) await restartBackendForActiveProject();
  return next;
});

ipcMain.handle("ctx:projects-forget", (_event, target: string) => forgetProject(target));

ipcMain.handle("ctx:workspace-choose", async () => {
  const result = await showFolderDialog("Choose a project folder");
  if (result.canceled || result.filePaths.length === 0) return null;
  const next = useProject(result.filePaths[0]);
  await restartBackendForActiveProject();
  return next;
});

/** Pick a location without applying it — used as the parent for a new folder. */
ipcMain.handle("ctx:workspace-pick", async () => {
  const result = await showFolderDialog("Choose a location");
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("ctx:workspace-create", async (_event, options: { parent: string; name: string }) => {
  const name = options.name.trim();
  if (!name) throw new Error("Folder name is required");
  if (name.includes("/") || name.includes("\\")) throw new Error("Folder name cannot contain slashes");
  const parent = path.resolve(options.parent);
  if (!isDirectory(parent)) throw new Error("Choose an existing folder for the location");
  const target = path.join(parent, name);
  fs.mkdirSync(target, { recursive: true });
  const next = useProject(target);
  await restartBackendForActiveProject();
  return next;
});

/** Save a generated file (document export) via the native Save dialog. */
ipcMain.handle(
  "ctx:save-file",
  async (_event, options: { defaultName: string; data: ArrayBuffer }) => {
    const dialogOptions: Electron.SaveDialogOptions = {
      title: "Save file",
      buttonLabel: "Save",
      defaultPath: path.join(app.getPath("downloads"), options.defaultName),
    };
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions);
    if (result.canceled || !result.filePath) return null;
    await fs.promises.writeFile(result.filePath, Buffer.from(options.data));
    return result.filePath;
  },
);

// ---------- Assets tab (app-level asset library) ----------

let assetLibrary: AssetLibrary | null = null;

/** The library lives beside the app's other user data, independent of projects. */
function assets(): AssetLibrary {
  if (!assetLibrary) {
    assetLibrary = new AssetLibrary(path.join(app.getPath("userData"), "assets"));
  }
  return assetLibrary;
}

ipcMain.handle("ctx:assets-catalog", () => assets().catalog());

ipcMain.handle("ctx:assets-import", async () => {
  const options: Electron.OpenDialogOptions = {
    title: "Import assets",
    buttonLabel: "Import",
    defaultPath: app.getPath("pictures"),
    properties: ["openFile", "multiSelections"],
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) {
    return { imported: [], skipped: [] };
  }
  return assets().importFiles(result.filePaths);
});

ipcMain.handle("ctx:assets-import-folder", async () => {
  const options: Electron.OpenDialogOptions = {
    title: "Import a folder (recursively)",
    buttonLabel: "Import folder",
    defaultPath: app.getPath("pictures"),
    properties: ["openDirectory"],
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) {
    return { imported: [], skipped: [] };
  }
  return assets().importFolder(result.filePaths[0]);
});

ipcMain.handle("ctx:assets-create-folder", (_event, folder: string) => assets().createFolder(folder));
ipcMain.handle("ctx:assets-move", (_event, ids: string[], folder: string) => assets().move(ids, folder));
ipcMain.handle("ctx:assets-update", (_event, id: string, patch: AssetPatch) => assets().update(id, patch));
ipcMain.handle("ctx:assets-delete", (_event, id: string) => assets().remove(id));
ipcMain.handle("ctx:assets-apply", (_event, actions) => assets().applyActions(actions));
ipcMain.handle("ctx:assets-reveal", (_event, id: string) => {
  const file = assets().filePath(id);
  if (file) shell.showItemInFolder(file);
  return Boolean(file);
});

// ---------- Browser tab (in-app WebContentsView) ----------

let viewManager: ViewManager | null = null;

function views(): ViewManager {
  if (!viewManager) {
    viewManager = new ViewManager(
      () => mainWindow,
      (event) => mainWindow?.webContents.send("ctx:view-event", event),
    );
  }
  return viewManager;
}

ipcMain.handle("ctx:view-create", (_event, id: string, url: string) => views().create(id, url));
ipcMain.on("ctx:view-set-bounds", (_event, id: string, bounds: ViewBounds) =>
  views().setBounds(id, bounds),
);
ipcMain.on("ctx:view-set-visible", (_event, id: string, visible: boolean) =>
  views().setVisible(id, visible),
);
ipcMain.handle("ctx:view-load", (_event, id: string, url: string) => views().load(id, url));
ipcMain.on("ctx:view-back", (_event, id: string) => views().back(id));
ipcMain.on("ctx:view-forward", (_event, id: string) => views().forward(id));
ipcMain.on("ctx:view-reload", (_event, id: string) => views().reload(id));
ipcMain.on("ctx:view-devtools", (_event, id: string) => views().devtools(id));
ipcMain.on("ctx:view-destroy", (_event, id: string) => views().destroy(id));
ipcMain.on("ctx:view-find", (_event, id: string, text: string) => views().find(id, text));
ipcMain.on("ctx:view-find-stop", (_event, id: string) => views().stopFind(id));
ipcMain.on("ctx:view-set-zoom", (_event, id: string, level: number) =>
  views().setZoom(id, level),
);

// ---------- PTY sessions (parallel agent terminals) ----------

let usageManager: UsageManager | null = null;
function usage(): UsageManager {
  if (!usageManager) {
    usageManager = new UsageManager(path.join(app.getPath("userData"), "usage"), __dirname);
    usageManager.subscribe(value => mainWindow?.webContents.send("ctx:usage-update", value));
  }
  return usageManager;
}
const pendingPtyStarts = new Map<string, symbol>();
const ptys = new PtyManager(
  (id, data) => { usageManager?.observe(id, data); mainWindow?.webContents.send("ctx:pty-data", id, data); },
  (id, code) => { usageManager?.finish(id); mainWindow?.webContents.send("ctx:pty-exit", id, code); },
);

/**
 * Only allow a per-run cwd inside one of the known projects or its managed
 * worktrees. Returns null when no project folder has been chosen yet.
 */
function resolvePtyCwd(requested?: string): string | null {
  const roots = projectStore().paths.map((entry) => path.resolve(entry));
  if (roots.length === 0) return null;
  if (requested) {
    const resolved = path.resolve(requested);
    for (const root of roots) {
      const worktrees = `${path.join(root, ".contextgit", "worktrees")}${path.sep}`;
      if ((resolved === root || resolved.startsWith(worktrees)) && isDirectory(resolved)) {
        return resolved;
      }
    }
  }
  return currentWorkspace()?.path ?? roots[0];
}

ipcMain.on(
  "ctx:pty-start",
  async (
    _event,
    options: {
      id: string;
      command: string;
      sessionId?: string;
      cols: number;
      rows: number;
      cwd?: string;
      input?: string;
      env?: Record<string, string>;
    },
  ) => {
    const ticket = Symbol();
    const captureRoot = backendRepoPath();
    pendingPtyStarts.set(options.id, ticket);
    const cwd = resolvePtyCwd(options.cwd);
    if (!cwd) {
      pendingPtyStarts.delete(options.id);
      // No project folder yet: tell the pane instead of spawning in the app dir.
      mainWindow?.webContents.send(
        "ctx:pty-data",
        options.id,
        "\r\nChoose a project folder before starting a terminal.\r\n",
      );
      mainWindow?.webContents.send("ctx:pty-exit", options.id, 1);
      return;
    }
    // GUI-launched Electron has a bare PATH; use the augmented one so a CLI in
    // ~/.local/bin, a mise shim or an npm global prefix is actually spawnable.
    try {
      const PATH = await augmentedPath();
      if (pendingPtyStarts.get(options.id) !== ticket) return;
      const observer = usage().prepare(options.id, options.sessionId ?? options.id, options.command, cwd);
      if (options.command === "opencode" && options.sessionId) {
        const response = await fetch(`${apiBase}/api/v1/sessions/${encodeURIComponent(options.sessionId)}/capture`, {
          headers: { Authorization: `Bearer ${apiToken}` }, signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error("Could not read the saved conversation binding");
        const state = await response.json();
        if (!["bound", "unbound"].includes(state.status)) throw new Error(state.detail ?? "Conversation capture is unavailable");
        const capture = prepareOpenCodeCapture(captureRoot, options.sessionId, cwd, state.binding?.native_id,
          observer.env.OPENCODE_CONFIG_CONTENT ?? options.env?.OPENCODE_CONFIG_CONTENT ?? process.env.OPENCODE_CONFIG_CONTENT ?? "{}");
        observer.args.push(...capture.args);
        Object.assign(observer.env, capture.env);
      }
      if (pendingPtyStarts.get(options.id) !== ticket || captureRoot !== backendRepoPath()) {
        usageManager?.finish(options.id);
        return;
      }
      pendingPtyStarts.delete(options.id);
      ptys.start({
        ...options, cwd, extraArgs: observer.args,
        env: { TERM: "xterm-256color", PATH, ...(options.env ?? {}), ...observer.env, PWD: cwd },
      });
    } catch (cause) {
      pendingPtyStarts.delete(options.id);
      usageManager?.finish(options.id);
      mainWindow?.webContents.send("ctx:pty-data", options.id, `\r\nCould not launch the CLI: ${cause instanceof Error ? cause.message : "check the installation and project folder"}.\r\n`);
      mainWindow?.webContents.send("ctx:pty-exit", options.id, 1);
    }
  },
);
ipcMain.on("ctx:pty-write", (_event, id: string, data: string) => ptys.write(id, data));
ipcMain.on("ctx:pty-resize", (_event, id: string, cols: number, rows: number) =>
  ptys.resize(id, cols, rows),
);
ipcMain.on("ctx:pty-kill", (_event, id: string) => {
  pendingPtyStarts.delete(id);
  usageManager?.finish(id);
  ptys.kill(id);
});
ipcMain.on("ctx:usage-activity", (event, visible: boolean, integrationActive: boolean) => {
  if (event.sender === mainWindow?.webContents) usage().activity(visible === true, integrationActive === true);
});
ipcMain.handle("ctx:harness-usage", (event, harness: string, sessionId?: string, refresh = false) => {
  if (event.sender !== mainWindow?.webContents || !HARNESS_BY_ID[harness] || (sessionId !== undefined && typeof sessionId !== "string")) throw new Error("Invalid usage request");
  return usage().read(harness, sessionId, refresh === true);
});
ipcMain.handle("ctx:pty-presets", () => Object.keys(PTY_PRESETS));

// ---------- Harness detection + hidden install ----------

/** Is a harness's CLI on PATH? `shell` is always ready. */
ipcMain.handle("ctx:harness-check", async (_event, id: string) => {
  const harness = HARNESS_BY_ID[id];
  if (!harness) return { id, command: id, installed: false, path: null };
  return checkHarness(harness);
});

/**
 * Install a harness globally. Resolves immediately; progress (and the final
 * result) arrive over `ctx:harness-progress`. Never shows a terminal.
 */
ipcMain.handle("ctx:harness-install", (_event, id: string) => {
  const harness = HARNESS_BY_ID[id];
  if (!harness) throw new Error(`Unknown harness: ${id}`);
  void installHarness(harness, (progress) => {
    mainWindow?.webContents.send("ctx:harness-progress", progress);
  });
  return { started: true };
});

ipcMain.on("ctx:harness-cancel", (_event, id: string) => cancelInstall(id));

ipcMain.handle("ctx:restart-backend", async () => {
  await restartBackendForActiveProject();
  return { status, apiBase };
});

app.whenReady().then(async () => {
  protocol.handle("ctxasset", async (request) => {
    const url = new URL(request.url);
    const id = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    const file = assets().filePath(id);
    if (!file) return new Response("Not found", { status: 404 });
    return enet.fetch(pathToFileURL(file).toString());
  });
  // Window first so the user sees the "starting" screen while the backend boots.
  await createWindow();
  await spawnBackend();
  if (app.isPackaged && !process.env.CONTEXTGIT_SMOKE) {
    // Give the first window time to mount before sending the initial status.
    setTimeout(() => { void updater.check(false); }, 2500);
  }
  if (process.env.CONTEXTGIT_SMOKE) {
    // Automated smoke test: verify the rendered DOM, then exit.
    setTimeout(async () => {
      let dom: unknown = "<no window>";
      let pty = "skipped";
      try {
        pty = String(await mainWindow?.webContents.executeJavaScript(`
          new Promise((resolve) => {
            const bridge = window.contextgit;
            if (!bridge) return resolve('no bridge');
            let seen = '';
            const off = bridge.onPtyData((id, data) => { if (id === 'smoke-pty') seen += data; });
            bridge.ptyStart({ id: 'smoke-pty', command: 'shell', cols: 80, rows: 24 });
            const smokeCommand = navigator.userAgent.includes('Windows')
              ? 'Write-Output PTY_ROUNDTRIP_42\\r\\n'
              : "printf 'PTY_ROUNDTRIP_42\\n'\\n";
            setTimeout(() => bridge.ptyWrite('smoke-pty', smokeCommand), 400);
            setTimeout(() => { off(); bridge.ptyKill('smoke-pty'); resolve(seen.includes('PTY_ROUNDTRIP_42') ? 'pty-ok' : 'pty-missing: ' + seen.slice(-120)); }, 2500);
          })
        `));
      } catch (cause) {
        pty = `PTY check failed: ${String(cause)}`;
      }
      try {
        dom = await mainWindow?.webContents.executeJavaScript(`
          (async () => {
            const base = window.contextgit.apiBase;
            const created = await fetch(base + '/api/v1/sessions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + window.contextgit.apiToken },
              body: JSON.stringify({ name: 'smoke run', kind: 'terminal', agent: 'claude' }),
            }).then((r) => r.json());
            await new Promise((r) => setTimeout(r, 5000));
            return {
              shell: Boolean(document.querySelector('.cg-shell')),
              topNav: Boolean(document.querySelector('.cg-segmented')),
              runs: document.querySelectorAll('.cg-row').length,
              sessionShown: document.body.innerText.includes('smoke run'),
              branchShown: document.body.innerText.includes(created.branch),
              title: document.title,
            };
          })()
        `);
      } catch (cause) {
        dom = `DOM check failed: ${String(cause)}`;
      }
      const domOk =
        typeof dom === "object" && dom !== null && (dom as { sessionShown?: boolean }).sessionShown === true;
      console.log("SMOKE_STATUS", JSON.stringify(status));
      console.log("SMOKE_PTY", pty);
      console.log("SMOKE_DOM", JSON.stringify(dom));
      // app.exit() does not reliably wait for child processes on Windows.
      // Stop the backend and PTYs explicitly before letting the runner remove
      // the unpacked application directory.
      ptys.killAll();
      killInstalls();
      await stopBackend().catch(cause => console.error("Smoke backend shutdown failed:", cause));
      app.exit(status.state === "ready" && pty === "pty-ok" && domOk ? 0 : 1);
    }, 14_000);
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  views().destroyAll();
  pendingPtyStarts.clear();
  usageManager?.stop();
  ptys.killAll();
  killInstalls();
  void stopBackend().catch(cause => console.error("Backend shutdown failed:", cause));
  app.quit();
});
app.on("before-quit", () => {
  views().destroyAll();
  pendingPtyStarts.clear();
  usageManager?.stop();
  ptys.killAll();
  killInstalls();
  void stopBackend().catch(cause => console.error("Backend shutdown failed:", cause));
});
