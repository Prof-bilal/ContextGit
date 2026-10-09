import { useCallback, useEffect, useRef, useState } from "react";
import { PollingTask } from "./pollingTask";

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
    poll.setAvailable(bridge.getStatus().status.state === "ready");
    void poll.tick().catch(report);
    const off = bridge.onStatus(status => {
      poll.setAvailable(status.state === "ready");
      if (status.state === "ready") void refresh();
    });
    const timer = intervalMs > 0 ? setInterval(() => void poll.tick().catch(report), intervalMs) : undefined;
    return () => {
      if (timer !== undefined) clearInterval(timer);
      off();
      poll.setAvailable(false);
      mounted.current = false;
    };
  }, [poll, intervalMs, task, report, refresh]);
  // Unexpected background failures enter the owning feature/resource boundary.
  if (failure) throw failure;
  return refresh;
}
