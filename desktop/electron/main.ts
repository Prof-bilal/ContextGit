/**
 * Electron main process: spawns the local ContextGit API (uvicorn in dev,
 * PyInstaller binary when packaged), health-gates the window on it, and
 * pushes backend status to the renderer.
 */
import { app, BrowserWindow, ipcMain } from "electron";
import { type ChildProcess, spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";

import { PTY_PRESETS, PtyManager } from "./pty";
import type { BackendStatus } from "../shared/status";

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

// ---------- PTY sessions (parallel agent terminals) ----------

const ptys = new PtyManager(
  (id, data) => mainWindow?.webContents.send("ctx:pty-data", id, data),
  (id, code) => mainWindow?.webContents.send("ctx:pty-exit", id, code),
);

ipcMain.on("ctx:pty-start", (_event, options: { id: string; command: string; cols: number; rows: number }) => {
  ptys.start({
    ...options,
    cwd: process.env.CONTEXTGIT_WORKDIR ?? repoRoot,
    env: { TERM: "xterm-256color" },
  });
});
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
