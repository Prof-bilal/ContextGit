import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

/** Never leave backend output in an unread pipe. stderr is bounded by the caller. */
export function launchBackend(binary: string, args: string[], options: SpawnOptions): ChildProcess {
  return spawn(binary, args, { ...options, stdio: ["ignore", "ignore", "pipe"] });
}

function exited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null || !child.pid;
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (exited(child)) return Promise.resolve(true);
  return new Promise(resolve => {
    const finish = (done: boolean) => {
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      resolve(done);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
  });
}

/** Await release of the old listening socket before launching a replacement. */
export async function terminateBackend(child: ChildProcess, graceMs = 5000, killMs = 2000): Promise<void> {
  if (exited(child)) return;
  const graceful = waitForExit(child, graceMs);
  child.kill(process.platform === "win32" ? undefined : "SIGTERM");
  if (await graceful) return;
  const forced = waitForExit(child, killMs);
  child.kill(process.platform === "win32" ? undefined : "SIGKILL");
  if (!(await forced)) throw new Error("The old backend did not exit. Retry reconnect after it stops.");
}

/** Concurrent reconnect clicks share one stop/start operation. */
export class BackendRestart {
  private pending: Promise<void> | null = null;
  run(operation: () => Promise<void>): Promise<void> {
    if (!this.pending) this.pending = Promise.resolve().then(operation).finally(() => { this.pending = null; });
    return this.pending;
  }
}
