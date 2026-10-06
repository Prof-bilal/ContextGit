import { useCallback, useEffect, useState } from "react";

import { api, type HarnessLimits } from "@/lib/api";

/**
 * Each CLI's account limits. Loaded when the Code tab is open and on demand;
 * the backend caches for 5 minutes, so this never polls the vendor APIs hard.
 */
export function useLimits(enabled: boolean) {
  const [limits, setLimits] = useState<HarnessLimits[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh: boolean) => {
    setLoading(true);
    try {
      setLimits(await api.limits(refresh));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load limits");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) void load(false);
  }, [enabled, load]);

  return { limits, loading, error, refresh: () => void load(true) };
}
