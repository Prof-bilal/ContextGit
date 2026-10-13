import { useCallback, useState } from "react";

import { api, type FleetEntry } from "@/shared/api";
import { useBackendPolling } from "../useBackendPolling";
import { useTransientError } from "../useTransientError";
import { useProjectState } from "../useProjectState";

/** In a plain browser there is no Tauri bridge and no local API to poll. */
const hasBridge = () => typeof window !== "undefined" && Boolean(window.contextgit);

/**
 * Code state of every run (`GET /api/v1/fleet`), polled so the rail can show
 * what each agent has changed and which runs are stepping on each other. The
 * endpoint reads git once per run, so it polls less often than sessions.
 */
export function useFleet() {
  const [fleet, setFleet] = useProjectState<FleetEntry[]>([]);
  const { error, reportSuccess, reportFailure } = useTransientError();

  const load = useCallback(async (current: () => boolean) => {
    if (!hasBridge() || !current()) return;
    try {
      const next = await api.fleet();
      if (!current()) return;
      setFleet(next);
      reportSuccess();
    } catch (cause) {
      if (!current()) return;
      reportFailure(cause instanceof Error ? cause.message : "Could not load run state");
    }
  }, [reportSuccess, reportFailure, setFleet]);

  const refresh = useBackendPolling(load, 6000);

  return { fleet, error };
}
