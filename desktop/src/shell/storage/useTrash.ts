import { useCallback, useState } from "react";

import { api, type Branch, type Session } from "@/shared/api";
import { useBackendPolling } from "../useBackendPolling";
import { useTransientError } from "../useTransientError";
import { useProjectState } from "../useProjectState";
import { useShellActivity } from "../activity";

/** In a plain browser there is no Tauri bridge and no local API to poll. */
const hasBridge = () => typeof window !== "undefined" && Boolean(window.contextgit);

/**
 * Storage contents from the backend (`GET /api/v1/trash`), polled so trashed
 * runs and branches appear and disappear as they are moved around.
 */
export function useTrash() {
  const activity = useShellActivity();
  const [sessions, setSessions] = useProjectState<Session[]>([]);
  const [branches, setBranches] = useProjectState<Branch[]>([]);
  const { error, reportSuccess, reportFailure } = useTransientError();

  const load = useCallback(async (current: () => boolean) => {
    if (!hasBridge() || !current()) return;
    try {
      const snapshot = await api.trash();
      if (!current()) return;
      setSessions(previous => JSON.stringify(previous) === JSON.stringify(snapshot.sessions) ? previous : snapshot.sessions);
      setBranches(previous => JSON.stringify(previous) === JSON.stringify(snapshot.branches) ? previous : snapshot.branches);
      reportSuccess();
    } catch (cause) {
      if (!current()) return;
      reportFailure(cause instanceof Error ? cause.message : "Could not load Storage");
    }
  }, [reportSuccess, reportFailure, setSessions, setBranches]);

  const refresh = useBackendPolling(load, 4000, { active: activity.tab === "git" && activity.storageOpen });

  const removeSession = useCallback((id: string) => {
    setSessions((current) => current.filter((session) => session.id !== id));
  }, [setSessions]);
  const removeBranch = useCallback((name: string) => {
    setBranches((current) => current.filter((branch) => branch.name !== name));
  }, [setBranches]);
  const clearStored = useCallback(() => {
    setSessions([]);
    setBranches([]);
  }, [setSessions, setBranches]);

  return { sessions, branches, error, refresh, removeSession, removeBranch, clearStored };
}
