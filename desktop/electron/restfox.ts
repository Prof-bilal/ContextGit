/**
 * The API sidecar: Restfox in its `web-standalone` form — an open-source API
 * client (collections, environments, history, sockets) that the API tab embeds
 * in a `WebContentsView`, the same way the Editor tab embeds VS Code and the DB
 * tab embeds DbGate.
 *
 * Its server exists to serve the built UI **and** to proxy requests (`POST
 * /proxy`), which is how the browser build avoids CORS. It binds loopback only
 * and is reached only by this app's sandboxed view.
 *
 * Restfox is a Node app, so it runs on Electron's own bundled Node
 * (`ELECTRON_RUN_AS_NODE`); we never ship a second runtime.
 */
import { type ChildProcess, spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";

import type { RestfoxStatus } from "../shared/restfox";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(url: string, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

export class RestfoxSidecar {
  private child: ChildProcess | null = null;
  private url: string | null = null;

  constructor(
    private readonly resolveEntry: () => string | null,
    /** The binary to run as Node — Electron's own, via `ELECTRON_RUN_AS_NODE`. */
    private readonly nodePath: string,
    private readonly onLog: (line: string) => void = () => undefined,
  ) {}

  status(): RestfoxStatus {
    return {
      available: Boolean(this.resolveEntry()),
      running: Boolean(this.child && this.url),
      url: this.url,
    };
  }

  async start(): Promise<{ ok: boolean; url?: string; error?: string }> {
    if (this.child && this.url) return { ok: true, url: this.url };
    if (this.child) this.stop();

    const entry = this.resolveEntry();
    if (!entry) {
      return {
        ok: false,
        error: "Restfox is not installed. Run `npm run fetch:restfox` in desktop/.",
      };
    }

    const port = await freePort();
    const url = `http://127.0.0.1:${port}/`;
    const child = spawn(this.nodePath, [entry], {
      // `express.static('public')` is relative to the cwd, so run from the
      // server directory rather than a separate data dir.
      cwd: path.dirname(entry),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT: String(port) },
    });
    child.stdout?.on("data", (chunk: Buffer) => this.onLog(chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => this.onLog(chunk.toString()));
    child.on("exit", () => {
      if (this.child === child) {
        this.child = null;
        this.url = null;
      }
    });
    this.child = child;

    if (!(await waitForHealth(url))) {
      this.stop();
      return { ok: false, error: "Restfox did not start in time." };
    }
    this.url = url;
    return { ok: true, url };
  }

  stop(): void {
    if (this.child && !this.child.killed) {
      this.child.removeAllListeners("exit");
      this.child.kill("SIGTERM");
    }
    this.child = null;
    this.url = null;
  }
}
