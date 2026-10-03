import { useCallback, useEffect, useState } from "react";

import type { Workspace } from "../../../shared/workspace";

/** In a plain browser there is no Electron bridge and no project picker. */
const HAS_BRIDGE = typeof window !== "undefined" && Boolean(window.contextgit);

/**
 * The project folder the Code tab works in. The main process owns the value
 * (and persists it), so choosing a folder here updates every new terminal.
 */
export function useWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!HAS_BRIDGE) return;
    let alive = true;
    void window.contextgit!
      .getWorkspace()
      .then((next) => {
        if (alive) setWorkspace(next);
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : "Could not read the project folder");
      });
    return () => {
      alive = false;
    };
  }, []);

  /** Open the native folder picker; applies and returns the choice (null if canceled). */
  const choose = useCallback(async () => {
    const next = await window.contextgit!.chooseWorkspace();
    if (next) setWorkspace(next);
    return next;
  }, []);

  /** Pick a location without applying it (used as a new folder's parent). */
  const pickLocation = useCallback(() => window.contextgit!.pickWorkspaceLocation(), []);

  const create = useCallback(async (parent: string, name: string) => {
    const next = await window.contextgit!.createWorkspace(parent, name);
    setWorkspace(next);
    return next;
  }, []);

  return { workspace, error, choose, pickLocation, create };
}
