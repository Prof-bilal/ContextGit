import { useCallback, useState } from "react";

import { api, type RepoSnapshot } from "@/lib/api";
import { useBackendPolling } from "../useBackendPolling";

/** In a plain browser there is no Electron bridge and no local API to read. */
const HAS_BRIDGE = typeof window !== "undefined" && Boolean(window.contextgit);

/** The real repository snapshot (`GET /api/v1/repo`) — the Git tab's data. */
export function useRepo() {
  const [snapshot, setSnapshot] = useState<RepoSnapshot | null>(null);
  const [loading, setLoading] = useState(HAS_BRIDGE);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (current: () => boolean) => {
    if (!HAS_BRIDGE) {
      setLoading(false);
      return;
    }
    try {
      const next = await api.snapshot();
      if (!current()) return;
      setSnapshot(next);
      setError(null);
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : "Could not load the repository");
    } finally {
      if (current()) setLoading(false);
    }
  }, []);

  // Event/mutation-driven: do not repeatedly download full history while idle.
  const refresh = useBackendPolling(load, 0);

  return { snapshot, loading, error, refresh };
}
