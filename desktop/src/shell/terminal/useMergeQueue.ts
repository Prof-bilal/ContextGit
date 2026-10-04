import { useCallback, useEffect, useState } from "react";

import { api, type MergeQueueEntry } from "@/lib/api";

/** In a plain browser there is no Electron bridge and no local API to poll. */
const HAS_BRIDGE = typeof window !== "undefined" && Boolean(window.contextgit);

/** The ordered merge queue (`GET /api/v1/merge-queue`), polled while merging. */
export function useMergeQueue() {
  const [queue, setQueue] = useState<MergeQueueEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!HAS_BRIDGE) return;
    try {
      setQueue(await api.mergeQueue());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the merge queue");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, [refresh]);

  const enqueue = useCallback(async (sessionId: string, target?: string) => {
    const entry = await api.enqueueMerge(sessionId, target);
    setQueue((current) => [...current, entry]);
    return entry;
  }, []);

  const dequeue = useCallback(async (id: number) => {
    await api.dequeueMerge(id);
    setQueue((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const run = useCallback(async (target?: string) => {
    const updated = await api.runMergeQueue(target);
    setQueue((current) =>
      current.map((entry) => updated.find((changed) => changed.id === entry.id) ?? entry),
    );
    return updated;
  }, []);

  return { queue, error, refresh, enqueue, dequeue, run };
}
