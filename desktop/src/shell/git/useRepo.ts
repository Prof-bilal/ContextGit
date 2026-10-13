import { useCallback, useState } from "react";

import { api, type RepoSnapshot } from "@/shared/api";
import { useBackendPolling } from "../useBackendPolling";
import { useProjectState } from "../useProjectState";

/** In a plain browser there is no Tauri bridge and no local API to read. */
const hasBridge = () => typeof window !== "undefined" && Boolean(window.contextgit);

/** The real repository snapshot (`GET /api/v1/repo`) — the Git tab's data. */
export function useRepo() {
  const [snapshot, setSnapshot, path] = useProjectState<RepoSnapshot | null>(null);
  const [loading, setLoading] = useProjectState(hasBridge);
  const [error, setError] = useProjectState<string | null>(null);

  const load = useCallback(async (current: () => boolean) => {
    if (!hasBridge()) {
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
  }, [path, setSnapshot, setError, setLoading]);

  // Event/mutation-driven: do not repeatedly download full history while idle.
  const refresh = useBackendPolling(load, 0);

  return { snapshot, loading, error, refresh };
}
