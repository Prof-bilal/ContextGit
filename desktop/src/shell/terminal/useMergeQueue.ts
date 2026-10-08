import { useCallback, useState } from "react";

import { api, type MergeQueueEntry } from "@/lib/api";
import { useBackendPolling } from "../useBackendPolling";
import { useTransientError } from "../useTransientError";

/** In a plain browser there is no Electron bridge and no local API to poll. */
const HAS_BRIDGE = typeof window !== "undefined" && Boolean(window.contextgit);

/** The ordered merge queue (`GET /api/v1/merge-queue`), polled while merging. */
export function useMergeQueue() {
  const [queue, setQueue] = useState<MergeQueueEntry[]>([]);
  const { error, reportSuccess, reportFailure } = useTransientError();

  const load = useCallback(async (current: () => boolean) => {
    if (!HAS_BRIDGE || !current()) return;
    try {
      const next = await api.mergeQueue();
      if (!current()) return;
      setQueue(next);
      reportSuccess();
    } catch (cause) {
      if (!current()) return;
      reportFailure(cause instanceof Error ? cause.message : "Could not load the merge queue");
    }
  }, [reportSuccess, reportFailure]);

  const refresh = useBackendPolling(load, 4000);

  const enqueue = useCallback(async (sessionId: string, target?: string) => {
    const entry = await api.enqueueMerge(sessionId, target);
    setQueue((current) => [...current, entry]);
    void refresh();
    return entry;
  }, [refresh]);

  const dequeue = useCallback(async (id: number) => {
    await api.dequeueMerge(id);
    setQueue((current) => current.filter((entry) => entry.id !== id));
    void refresh();
  }, [refresh]);

  const run = useCallback(async (target?: string) => {
    const updated = await api.runMergeQueue(target);
    setQueue((current) =>
      current.map((entry) => updated.find((changed) => changed.id === entry.id) ?? entry),
    );
    void refresh();
    return updated;
  }, [refresh]);

  return { queue, error, refresh, enqueue, dequeue, run };
}
