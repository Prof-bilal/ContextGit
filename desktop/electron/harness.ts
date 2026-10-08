/**
 * Harness detection + hidden install.
 *
 * GUI-launched Electron inherits a bare PATH (no shell rc), so a CLI installed
 * in ~/.local/bin, a mise shim or an npm global prefix would look "missing".
 * `augmentedPath()` merges the usual user/toolchain bin dirs (and the live npm
 * global prefix) so detection — and the PTY itself — find them.
 *
 * Installing never opens a terminal: it is a normal child process whose output
 * is streamed to the renderer as progress events.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import type { Harness, HarnessInstallEvent } from "../shared/harnesses";

const isWindows = process.platform === "win32";

interface ActiveInstall {
  child: ChildProcess;
  onEvent: (event: HarnessInstallEvent) => void;
  cancelled: boolean;
  settled: boolean;
}

/** The installs currently running, keyed by harness id. */
const installers = new Map<string, ActiveInstall>();
/** Ids claimed synchronously, before the async setup reaches `installers`. */
const pending = new Set<string>();

function pathEntries(): string[] {
  return (process.env.PATH ?? "").split(delimiter).filter(Boolean);
}

/** Every mise-managed Node bin dir (global npm packages live there). */
function miseNodeBinDirs(): string[] {
  const root = join(homedir(), ".local", "share", "mise", "installs", "node");
  try {
    return readdirSync(root)
      .map((version) => join(root, version, "bin"))
      .filter((dir) => existsSync(dir));
  } catch {
    return [];
  }
}

let cachedPath: string | null = null;

/**
 * PATH the main process should use to find CLIs and npm: the inherited PATH
 * plus the common user/toolchain locations, deduplicated in order.
 */
export async function augmentedPath(): Promise<string> {
  if (cachedPath) return cachedPath;
  const home = homedir();
  const candidates = [
    ...pathEntries(),
    join(home, ".local", "bin"),
    join(home, ".npm-global", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".volta", "bin"),
    join(home, ".cargo", "bin"),
    join(home, ".local", "share", "mise", "shims"),
    ...miseNodeBinDirs(),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    ...(isWindows ? [] : ["/usr/bin", "/bin", "/usr/sbin", "/sbin"]),
  ];
  const seen = new Set<string>();
  const merged = candidates.filter((entry) => {
    if (!entry || seen.has(entry)) return false;
    seen.add(entry);
    return true;
  });

  // The npm global prefix moves with the active Node version, so ask npm.
  const npm = isWindows ? "npm.cmd" : "npm";
  const prefix = await npmGlobalPrefix(npm, merged.join(delimiter));
  if (prefix) {
    const bin = isWindows ? prefix : join(prefix, "bin");
    if (!seen.has(bin) && existsSync(bin)) merged.push(bin);
  }

  cachedPath = merged.join(delimiter);
  return cachedPath;
}

function npmGlobalPrefix(npm: string, pathValue: string): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const child = spawn(npm, ["prefix", "-g"], {
        env: { ...process.env, PATH: pathValue },
        stdio: ["ignore", "pipe", "ignore"],
      });
      let out = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        out += chunk.toString();
      });
      child.on("error", () => done(null));
      child.on("close", (code) => done(code === 0 && out.trim() ? out.trim() : null));
      setTimeout(() => {
        child.kill();
        done(null);
      }, 3000);
    } catch {
      done(null);
    }
  });
}

/** Absolute path of `cmd` on the augmented PATH, or null when it is missing. */
export async function findCommand(cmd: string): Promise<string | null> {
  const pathValue = await augmentedPath();
  const dirs = pathValue.split(delimiter).filter(Boolean);
  const exts = isWindows
    ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = join(dir, cmd + ext);
      try {
        if (statSync(full).isFile()) return full;
      } catch {
        // not here; keep scanning
      }
    }
  }
  return null;
}

/** Is the harness's command installed? `shell` (no command) is always ready. */
export async function checkHarness(harness: Harness): Promise<{
  id: string;
  command: string;
  installed: boolean;
  path: string | null;
}> {
  if (!harness.command) {
    return { id: harness.id, command: "shell", installed: true, path: null };
  }
  const found = await findCommand(harness.command);
  return { id: harness.id, command: harness.command, installed: found !== null, path: found };
}

/**
 * Install a harness globally with npm, streaming progress. Resolves when the
 * install finishes (successfully or not); never throws.
 */
export async function installHarness(
  harness: Harness,
  onEvent: (event: HarnessInstallEvent) => void,
  options?: { prefix: string; verifyPath: string },
): Promise<void> {
  const id = harness.id;
  // Claim the id synchronously so a second call (StrictMode double-mount, or a
  // double click) cannot start a parallel install during the awaits below.
  if (installers.has(id) || pending.has(id)) return;
  pending.add(id);
  if (!harness.npmPackage) {
    pending.delete(id);
    onEvent({ id, phase: "error", error: `${harness.label} has no automatic installer.` });
    return;
  }

  const pathValue = await augmentedPath();
  const npm = await findCommand(isWindows ? "npm.cmd" : "npm");
  if (!npm) {
    pending.delete(id);
    onEvent({
      id,
      phase: "error",
      error: "npm not found. Install Node.js, then try again.",
    });
    return;
  }

  const args = options
    ? ["install", "--prefix", options.prefix, "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact", harness.npmPackage]
    : ["install", "-g", ...(harness.installArgs ?? []), harness.npmPackage];
  onEvent({ id, phase: "installing", percent: 0.08, line: `npm ${args.join(" ")}` });

  const child = spawn(npm, args, {
    env: { ...process.env, CONTEXTGIT_API_TOKEN: undefined, PATH: pathValue },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const active: ActiveInstall = { child, onEvent, cancelled: false, settled: false };
  installers.set(id, active);
  pending.delete(id);

  const finish = (code: number | null, error?: string): void => {
    if (active.settled) return;
    active.settled = true;
    if (installers.get(id) === active) installers.delete(id);
    if (active.cancelled) {
      onEvent({ id, phase: "error", error: "Install cancelled." });
      return;
    }
    if (error) {
      onEvent({ id, phase: "error", error });
      return;
    }
    if (code !== 0) {
      onEvent({ id, phase: "error", error: `npm exited with code ${code}.` });
    }
  };

  let buffer = "";
  const onData = (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    const line = lines.map((entry) => entry.trim()).filter(Boolean).pop();
    if (line) onEvent({ id, phase: "installing", percent: 0.5, line });
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);

  const failed = await new Promise<boolean>((resolve) => {
    child.on("error", (cause: Error) => {
      finish(null, cause.message);
      resolve(true);
    });
    child.on("close", (code) => {
      finish(code ?? -1);
      resolve(active.cancelled || code !== 0);
    });
  });
  if (failed) return;

  onEvent({ id, phase: "verifying", percent: 0.9, line: "Verifying installation…" });
  const found = options
    ? (existsSync(options.verifyPath) ? options.verifyPath : null)
    : harness.command ? await findCommand(harness.command) : null;
  if (harness.command && !found) {
    onEvent({
      id,
      phase: "error",
      error: "Installed, but the command is not on PATH yet. Restart ContextGit.",
    });
    return;
  }
  onEvent({ id, phase: "done", percent: 1, line: found ?? "installed", path: found ?? undefined });
}

/** Stop an in-flight install; the close handler reports the cancellation. */
export function cancelInstall(id: string): void {
  const active = installers.get(id);
  if (!active) return;
  active.cancelled = true;
  try {
    active.child.kill();
  } catch {
    // already gone
  }
}

/** Kill any installs still running (app shutdown). */
export function killInstalls(): void {
  for (const id of [...installers.keys()]) cancelInstall(id);
}
