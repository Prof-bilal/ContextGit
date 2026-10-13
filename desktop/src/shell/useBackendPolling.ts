import { useCallback, useEffect, useRef, useState } from "react";
import { PollingTask } from "./pollingTask";
import { projectRuntime } from "../../shared/projectRuntime";

/** Keep the workspace mounted, stop polling during outages, and refresh on recovery. */
export function useBackendPolling(task: (current: () => boolean) => Promise<void>, intervalMs: number) {
  const [failure, setFailure] = useState<Error | null>(null);
  const latest = useRef(task);
  latest.current = task;
  const runner = useRef<PollingTask | null>(null);
  if (!runner.current) runner.current = new PollingTask(current => latest.current(current));
  const poll = runner.current;
  const mounted = useRef(false);
  const report = useCallback((cause: unknown) => {
    if (mounted.current) setFailure(cause instanceof Error ? cause : new Error(String(cause)));
  }, []);
  const refresh = useCallback(() => poll.refresh().catch(report), [poll, report]);
  useEffect(() => {
    mounted.current = true;
    const bridge = window.contextgit;
    // Plain browser previews have no API to poll.
    if (!bridge) return () => { mounted.current = false; };
    const initial = bridge.getStatus();
    let backendKey = initial.status.state === "ready" ? initial.apiBase : null;
    // Background polling is pure overhead when the window is hidden.  More
    // importantly, some of these endpoints spawn git processes, so keep the
    // renderer quiet while the user is working elsewhere.
    const visible = () => document.visibilityState === "visible";
    const available = () => backendKey !== null && projectRuntime.read().ready && visible();
    poll.setAvailable(available());
    void poll.tick().catch(report);
    const off = bridge.onStatus(status => {
      const nextKey = status.state === "ready" ? status.apiBase : null;
      if (nextKey === backendKey) return;
      backendKey = nextKey;
      poll.setAvailable(available());
      if (available()) void refresh();
    });
    const offProject = projectRuntime.subscribe(() => {
      poll.setAvailable(false);
      poll.setAvailable(available());
      if (available()) void refresh();
    });
    const onVisibilityChange = () => {
      poll.setAvailable(available());
      if (available()) void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    const timer = intervalMs > 0 ? setInterval(() => void poll.tick().catch(report), intervalMs) : undefined;
    return () => {
      if (timer !== undefined) clearInterval(timer);
      off();
      offProject();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      poll.setAvailable(false);
      mounted.current = false;
    };
  }, [poll, intervalMs, report, refresh]);
  // Unexpected background failures enter the owning feature/resource boundary.
  if (failure) throw failure;
  return refresh;
}
