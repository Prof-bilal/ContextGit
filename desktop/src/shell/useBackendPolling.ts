import { useCallback, useEffect, useRef, useState } from "react";
import { PollingTask } from "./pollingTask";
import { projectRuntime } from "../../shared/projectRuntime";

/** One active request; timers exist only for visible, relevant, connected views. */
export function useBackendPolling(task: (current: () => boolean) => Promise<void>, intervalMs: number, { active = true }: { active?: boolean } = {}) {
  const [failure, setFailure] = useState<Error | null>(null);
  const latest = useRef(task);
  latest.current = task;
  const lastRead = useRef(0);
  const runner = useRef<PollingTask | null>(null);
  if (!runner.current) runner.current = new PollingTask(current => {
    return latest.current(current).then(() => { if (current()) lastRead.current = Date.now(); });
  });
  const poll = runner.current;
  const mounted = useRef(false);
  const report = useCallback((cause: unknown) => {
    if (mounted.current) setFailure(cause instanceof Error ? cause : new Error(String(cause)));
  }, []);
  const refresh = useCallback(() => poll.refresh().catch(report), [poll, report]);
  useEffect(() => {
    mounted.current = true;
    const bridge = window.contextgit;
    if (!bridge) return () => { mounted.current = false; };
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const initial = bridge.getStatus();
    let backendKey = initial.status.state === "ready" ? initial.apiBase : null;
    let projectKey = projectRuntime.read().path;
    let projectReady = projectRuntime.read().ready;
    const available = () => active && backendKey !== null && projectReady && document.visibilityState === "visible";
    const schedule = () => {
      clearTimeout(timer);
      if (!disposed && intervalMs > 0 && available()) timer = setTimeout(() => {
        void poll.tick().catch(report).finally(schedule);
      }, intervalMs);
    };
    const reconcile = (invalidate = false) => {
      if (invalidate) { poll.setAvailable(false); lastRead.current = 0; }
      poll.setAvailable(available());
      // Rapid tab/focus changes reuse a just-completed read. Explicit mutation
      // refreshes bypass this short freshness window.
      if (available() && Date.now() - lastRead.current >= 1000) void poll.refresh().catch(report).finally(schedule);
      else if (available()) schedule();
      else clearTimeout(timer);
    };
    reconcile();
    const off = bridge.onStatus(status => {
      const next = status.state === "ready" ? bridge.getStatus().apiBase : null;
      if (next === backendKey) return;
      backendKey = next;
      reconcile(true);
    });
    const offProject = projectRuntime.subscribe(() => {
      const next = projectRuntime.read();
      if (next.path === projectKey && next.ready === projectReady) return;
      projectKey = next.path; projectReady = next.ready;
      reconcile(true);
    });
    const onVisibilityChange = () => reconcile();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      disposed = true; mounted.current = false;
      clearTimeout(timer); off(); offProject();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      poll.setAvailable(false);
    };
  }, [poll, intervalMs, active, report]);
  if (failure) throw failure;
  return refresh;
}
