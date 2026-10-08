/**
 * The database sidecar: DbGate Community (`dbgate-serve`) — a real, multi-engine
 * database client (MySQL, Postgres, SQL Server, MongoDB, Redis, SQLite, …) that
 * the DB tab embeds in a `WebContentsView`, the same way the Editor tab embeds
 * VS Code.
 *
 * It binds loopback only, on a random port, reached only by this app's sandboxed
 * view — the same trust model as the editor sidecar, so auth is skipped and the
 * port is never exposed to the network.
 *
 * DbGate is a Node app, so it runs on Electron's own bundled Node
 * (`ELECTRON_RUN_AS_NODE`); we never ship a second runtime.
 */
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import type { DbGateStatus } from "../shared/dbgate";

/** The default DbGate port, used only if `PORT` is not honoured. */
const DEFAULT_PORT = 3000;

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

async function firstHealthy(urls: string[], timeoutMs = 40_000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const url of urls) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
        if (response.ok) return url;
      } catch {
        // not up yet
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return null;
}

export class DbGateSidecar {
  private child: ChildProcess | null = null;
  private url: string | null = null;

  constructor(
    private readonly resolveEntry: () => string | null,
    private readonly dataDir: string,
    /** The binary to run as Node — Electron's own, via `ELECTRON_RUN_AS_NODE`. */
    private readonly nodePath: string,
    private readonly onLog: (line: string) => void = () => undefined,
  ) {}

  status(): DbGateStatus {
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
        error: "DbGate is not installed. Run `npm run fetch:dbgate` in desktop/.",
      };
    }

    const port = await freePort();
    fs.mkdirSync(this.dataDir, { recursive: true });
    const child = spawn(this.nodePath, [entry], {
      cwd: this.dataDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        // DbGate keeps its state in `~/.dbgate`; point HOME at our data dir so
        // it never writes into the user's home directory.
        HOME: this.dataDir,
        USERPROFILE: this.dataDir,
        PORT: String(port),
        // Loopback + our sandboxed view only, so we skip the login form — the
        // same call the editor sidecar makes for code-server.
        SKIP_ALL_AUTH: "1",
        LOG_LEVEL: "warn",
      },
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

    // DbGate usually honours PORT; if it falls back to its default, take that.
    const url = await firstHealthy([
      `http://127.0.0.1:${port}/`,
      `http://127.0.0.1:${DEFAULT_PORT}/`,
    ]);
    if (!url) {
      this.stop();
      return { ok: false, error: "DbGate did not start in time." };
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
