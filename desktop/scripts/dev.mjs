/**
 * Dev runner: starts Vite, waits for it, then launches Electron with the
 * dev-server URL. Ctrl+C (or Electron exit) tears everything down.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, "..");
const rendererUrl = "http://127.0.0.1:5173";

function run(command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: desktopRoot,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
  });
  child.on("exit", (code) => shutdown(code ?? 0));
  return child;
}

const children = [];
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exit(code);
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Dev server at ${url} did not start in ${timeoutMs}ms`);
}

const vite = run("npx", ["vite", "--host", "127.0.0.1"]);
children.push(vite);
await waitForServer(rendererUrl);

const electron = run("npx", ["electron", ".", ], {
  VITE_DEV_SERVER_URL: rendererUrl,
});
children.push(electron);

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
