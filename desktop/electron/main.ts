/**
 * Electron main process: spawns the local ContextGit API (uvicorn in dev,
 * PyInstaller binary when packaged), health-gates the window on it, and
 * pushes backend status to the renderer.
 */
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import { PTY_PRESETS, PtyManager } from "./pty";
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

const isDev = !app.isPackaged;
const repoRoot = path.resolve(app.getAppPath(), "..");
const backendPort = Number(process.env.CONTEXTGIT_PORT ?? 8756);
const apiBase = `http://127.0.0.1:${backendPort}`;

let backend: ChildProcess | null = null;
let status: BackendStatus = { state: "starting" };
let mainWindow: BrowserWindow | null = null;

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

async function spawnBackend(): Promise<void> {
  const env = {
    ...process.env,
    CONTEXTGIT_HOST: "127.0.0.1",
    CONTEXTGIT_PORT: String(backendPort),
    CONTEXTGIT_REPO:
      process.env.CONTEXTGIT_REPO ?? path.join(app.getPath("userData"), "contextgit"),
    // Renderer origin: dev server (Vite) or file:// (packaged) — allow both.
    CONTEXTGIT_CORS_ORIGINS: process.env.CONTEXTGIT_CORS_ORIGINS
      ?? "http://localhost:5173,http://127.0.0.1:5173,null",
  };
  const binary = isDev
    ? path.join(repoRoot, ".venv", "bin", "uvicorn")
    : path.join(process.resourcesPath, "backend", "contextgit-api");
  const args = isDev
    ? ["contextgit.api.main:app", "--host", "127.0.0.1", "--port", String(backendPort)]
    : [];
  if (isDev && !(await getPortFree(backendPort))) {
    // A dev server is already running; reuse it instead of failing.
    setStatus({ state: "ready", apiBase });
    return;
  }
  backend = spawn(binary, args, {
    cwd: isDev ? repoRoot : process.resourcesPath,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  backend.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });
  backend.on("error", (cause: Error) => {
    // `spawn` emits this asynchronously (e.g. ENOENT when the binary is missing).
    // Without a handler Node rethrows it, crashing the main process instead of
    // showing the "Backend failed" screen.
    setStatus({
      state: "error",
      message: `Backend could not start (${cause.message}). ${stderr}`,
    });
    backend = null;
  });
  backend.on("exit", (code) => {
    if (status.state === "ready") {
      setStatus({ state: "error", message: `Backend exited (code ${code}). ${stderr}` });
    } else {
      setStatus({ state: "error", message: `Backend failed to start. ${stderr}` });
    }
    backend = null;
  });
  await waitForHealth();
}

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (!backend) return; // exited already; error status set by handler
    try {
      const response = await fetch(`${apiBase}/api/v1/health`, {
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) {
        setStatus({ state: "ready", apiBase });
        return;
      }
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  setStatus({ state: "error", message: `Backend health check timed out on ${apiBase}` });
}

function stopBackend(): void {
  if (backend && !backend.killed) {
    backend.removeAllListeners("exit");
    backend.kill("SIGTERM");
    backend = null;
  }
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
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  }
}

ipcMain.on("ctx:status-sync", (event) => {
  event.returnValue = { status, apiBase };
});

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

ipcMain.handle("ctx:projects-use", (_event, target: string) =>
  isDirectory(target) ? useProject(target) : currentWorkspace(),
);

ipcMain.handle("ctx:projects-forget", (_event, target: string) => forgetProject(target));

ipcMain.handle("ctx:workspace-choose", async () => {
  const result = await showFolderDialog("Choose a project folder");
  if (result.canceled || result.filePaths.length === 0) return null;
  return useProject(result.filePaths[0]);
});

/** Pick a location without applying it — used as the parent for a new folder. */
ipcMain.handle("ctx:workspace-pick", async () => {
  const result = await showFolderDialog("Choose a location");
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("ctx:workspace-create", (_event, options: { parent: string; name: string }) => {
  const name = options.name.trim();
  if (!name) throw new Error("Folder name is required");
  if (name.includes("/") || name.includes("\\")) throw new Error("Folder name cannot contain slashes");
  const parent = path.resolve(options.parent);
  if (!isDirectory(parent)) throw new Error("Choose an existing folder for the location");
  const target = path.join(parent, name);
  fs.mkdirSync(target, { recursive: true });
  return useProject(target);
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

// ---------- PTY sessions (parallel agent terminals) ----------

const ptys = new PtyManager(
  (id, data) => mainWindow?.webContents.send("ctx:pty-data", id, data),
  (id, code) => mainWindow?.webContents.send("ctx:pty-exit", id, code),
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
      cols: number;
      rows: number;
      cwd?: string;
      input?: string;
      env?: Record<string, string>;
    },
  ) => {
    const cwd = resolvePtyCwd(options.cwd);
    if (!cwd) {
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
    const PATH = await augmentedPath();
    ptys.start({
      ...options,
      cwd,
      // A run's own PORT keeps its dev server off every other run's.
      env: { TERM: "xterm-256color", PATH, ...(options.env ?? {}) },
    });
  },
);
ipcMain.on("ctx:pty-write", (_event, id: string, data: string) => ptys.write(id, data));
ipcMain.on("ctx:pty-resize", (_event, id: string, cols: number, rows: number) =>
  ptys.resize(id, cols, rows),
);
ipcMain.on("ctx:pty-kill", (_event, id: string) => ptys.kill(id));
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
  stopBackend();
  setStatus({ state: "starting" });
  await spawnBackend();
  return { status, apiBase };
});

app.whenReady().then(async () => {
  // Window first so the user sees the "starting" screen while the backend boots.
  await createWindow();
  await spawnBackend();
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
            setTimeout(() => bridge.ptyWrite('smoke-pty', 'echo PTY_ROUNDTRIP_$((6*7))\\n'), 400);
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
              headers: { 'Content-Type': 'application/json' },
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
      app.exit(status.state === "ready" && pty === "pty-ok" && domOk ? 0 : 1);
    }, 14_000);
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  ptys.killAll();
  killInstalls();
  stopBackend();
  app.quit();
});
app.on("before-quit", () => {
  ptys.killAll();
  killInstalls();
  stopBackend();
});
