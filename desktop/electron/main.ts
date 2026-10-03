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

// ---------- Workspace (project folder) ----------

/**
 * The folder the user works in. New terminals and agents start here; it is
 * chosen in the Code tab and persisted per machine. `CONTEXTGIT_WORKDIR`, when
 * set, is a hard override (used by tests/scripts).
 */
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

function readWorkspace(): Workspace {
  const override = process.env.CONTEXTGIT_WORKDIR;
  if (override && isDirectory(override)) return toWorkspace(override);
  try {
    const parsed = JSON.parse(fs.readFileSync(workspaceFile(), "utf8")) as { path?: unknown };
    if (typeof parsed.path === "string" && isDirectory(parsed.path)) return toWorkspace(parsed.path);
  } catch {
    // no saved workspace yet
  }
  return toWorkspace(repoRoot);
}

let workspace: Workspace | null = null;

function currentWorkspace(): Workspace {
  workspace ??= readWorkspace();
  return workspace;
}

function setWorkspace(target: string): Workspace {
  workspace = toWorkspace(target);
  try {
    fs.mkdirSync(path.dirname(workspaceFile()), { recursive: true });
    fs.writeFileSync(workspaceFile(), `${JSON.stringify({ path: workspace.path }, null, 2)}\n`);
  } catch {
    // persistence is best-effort; the in-memory value still applies
  }
  return workspace;
}

/** Native folder picker. `createDirectory` adds the dialog's "New Folder" button. */
function showFolderDialog(title: string): Promise<Electron.OpenDialogReturnValue> {
  const options: Electron.OpenDialogOptions = {
    title,
    buttonLabel: "Use this folder",
    defaultPath: currentWorkspace().path,
    properties: ["openDirectory", "createDirectory"],
  };
  return mainWindow ? dialog.showOpenDialog(mainWindow, options) : dialog.showOpenDialog(options);
}

ipcMain.handle("ctx:workspace-get", () => currentWorkspace());

ipcMain.handle("ctx:workspace-choose", async () => {
  const result = await showFolderDialog("Choose a project folder");
  if (result.canceled || result.filePaths.length === 0) return null;
  return setWorkspace(result.filePaths[0]);
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
  return setWorkspace(target);
});

// ---------- PTY sessions (parallel agent terminals) ----------

const ptys = new PtyManager(
  (id, data) => mainWindow?.webContents.send("ctx:pty-data", id, data),
  (id, code) => mainWindow?.webContents.send("ctx:pty-exit", id, code),
);

/** Only allow a per-run cwd inside the workspace or its managed worktrees. */
function resolvePtyCwd(requested?: string): string {
  const workspace = currentWorkspace().path;
  if (requested) {
    const resolved = path.resolve(requested);
    const worktrees = `${path.join(workspace, ".contextgit", "worktrees")}${path.sep}`;
    const inside =
      resolved === path.resolve(workspace) || resolved.startsWith(worktrees);
    if (inside && isDirectory(resolved)) return resolved;
  }
  return isDirectory(workspace) ? workspace : repoRoot;
}

ipcMain.on(
  "ctx:pty-start",
  (_event, options: { id: string; command: string; cols: number; rows: number; cwd?: string }) => {
    ptys.start({
      ...options,
      cwd: resolvePtyCwd(options.cwd),
      env: { TERM: "xterm-256color" },
    });
  },
);
ipcMain.on("ctx:pty-write", (_event, id: string, data: string) => ptys.write(id, data));
ipcMain.on("ctx:pty-resize", (_event, id: string, cols: number, rows: number) =>
  ptys.resize(id, cols, rows),
);
ipcMain.on("ctx:pty-kill", (_event, id: string) => ptys.kill(id));
ipcMain.handle("ctx:pty-presets", () => Object.keys(PTY_PRESETS));

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
  stopBackend();
  app.quit();
});
app.on("before-quit", () => {
  ptys.killAll();
  stopBackend();
});
