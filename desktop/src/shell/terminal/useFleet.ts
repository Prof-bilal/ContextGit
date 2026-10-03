import { useCallback, useEffect, useState } from "react";

import { api, type FleetEntry } from "@/lib/api";

/** In a plain browser there is no Electron bridge and no local API to poll. */
const HAS_BRIDGE = typeof window !== "undefined" && Boolean(window.contextgit);

/**
 * Code state of every run (`GET /api/v1/fleet`), polled so the rail can show
 * what each agent has changed and which runs are stepping on each other. The
 * endpoint reads git once per run, so it polls less often than sessions.
 */
export function useFleet() {
  const [fleet, setFleet] = useState<FleetEntry[]>([]);

  const refresh = useCallback(async () => {
    if (!HAS_BRIDGE) return;
    try {
      setFleet(await api.fleet());
    } catch {
      // the rail simply shows no code state while the backend is unreachable
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 6000);
    return () => clearInterval(timer);
  }, [refresh]);

  return fleet;
}
