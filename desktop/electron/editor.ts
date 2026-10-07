/**
 * The editor sidecar: a local `code-server` (real VS Code) that the Editor tab
 * embeds in a `WebContentsView`. It binds loopback only, on a random port, with
 * its own user-data and extensions directories under the app's userData.
 *
 * We run `--auth none` because the port is bound to 127.0.0.1 and reached only
 * by this app's sandboxed view — never exposed to the network.
 */
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

export interface EditorStatus {
  /** The code-server binary was found. */
  available: boolean;
  running: boolean;
  url: string | null;
}

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

async function waitForHealth(url: string): Promise<boolean> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}healthz`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

export class EditorSidecar {
  private child: ChildProcess | null = null;
  private url: string | null = null;
  private folder: string | null = null;

  constructor(
    private readonly resolveBinary: () => string | null,
    private readonly dataDir: string,
    private readonly onLog: (line: string) => void = () => undefined,
  ) {}

  status(): EditorStatus {
    return { available: Boolean(this.resolveBinary()), running: Boolean(this.child && this.url), url: this.url };
  }

  async start(
    folder: string | null,
    extraEnv: Record<string, string> = {},
  ): Promise<{ ok: boolean; url?: string; error?: string }> {
    // Already running on the same folder: reuse it. A different folder restarts.
    if (this.child && this.url && folder === this.folder) return { ok: true, url: this.url };
    if (this.child) this.stop();
    const binary = this.resolveBinary();
    if (!binary) return { ok: false, error: "The editor is not installed. Run `npm run fetch:editor`." };

    const port = await freePort();
    const url = `http://127.0.0.1:${port}/`;
    fs.mkdirSync(this.dataDir, { recursive: true });
    const args = [
      "--bind-addr",
      `127.0.0.1:${port}`,
      "--auth",
      "none",
      "--disable-telemetry",
      "--disable-update-check",
      "--disable-workspace-trust",
      "--user-data-dir",
      path.join(this.dataDir, "user-data"),
      "--extensions-dir",
      path.join(this.dataDir, "extensions"),
      ...(folder ? [folder] : []),
    ];
    const child = spawn(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      // Electron's PATH is bare, so VS Code's built-in git extension (and the
      // Source Control Graph) cannot find `git` — pass the augmented PATH.
      env: { ...process.env, PORT: String(port), ...extraEnv },
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
      return { ok: false, error: "The editor did not start in time." };
    }
    this.url = url;
    this.folder = folder;
    return { ok: true, url };
  }

  stop(): void {
    if (this.child && !this.child.killed) {
      this.child.removeAllListeners("exit");
      this.child.kill("SIGTERM");
    }
    this.child = null;
    this.url = null;
    this.folder = null;
  }
}
