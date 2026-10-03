import { useCallback, useEffect, useState } from "react";

import { api, type RepoSnapshot } from "@/lib/api";

/** In a plain browser there is no Electron bridge and no local API to read. */
const HAS_BRIDGE = typeof window !== "undefined" && Boolean(window.contextgit);

/** The real repository snapshot (`GET /api/v1/repo`) — the Git tab's data. */
export function useRepo() {
  const [snapshot, setSnapshot] = useState<RepoSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!HAS_BRIDGE) {
      setLoading(false);
      return;
    }
    try {
      setSnapshot(await api.snapshot());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the repository");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { snapshot, loading, error, refresh };
}
