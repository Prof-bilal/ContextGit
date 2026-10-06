import { useCallback, useEffect, useState } from "react";

import type { Workspace } from "../../../shared/workspace";

/** In a plain browser there is no Electron bridge and no project picker. */
const HAS_BRIDGE = typeof window !== "undefined" && Boolean(window.contextgit);

/**
 * The project folders the Code tab works in, plus which one is active. The main
 * process owns the list (and persists it), so opening or switching a project
 * here updates every new terminal.
 */
export function useProjects() {
  const [projects, setProjects] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!HAS_BRIDGE) return;
    try {
      const [list, active] = await Promise.all([
        window.contextgit!.listProjects(),
        window.contextgit!.getWorkspace(),
      ]);
      setProjects(list);
      setWorkspace(active);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the project folders");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Open the native folder picker; adds and activates the choice (null if canceled). */
  const choose = useCallback(async () => {
    const next = await window.contextgit!.chooseWorkspace();
    await reload();
    return next;
  }, [reload]);

  /** Pick a location without applying it (used as a new folder's parent). */
  const pickLocation = useCallback(() => window.contextgit!.pickWorkspaceLocation(), []);

  const create = useCallback(
    async (parent: string, name: string) => {
      const next = await window.contextgit!.createWorkspace(parent, name);
      await reload();
      return next;
    },
    [reload],
  );

  /** Switch the active project to one already in the list. */
  const use = useCallback(
    async (path: string) => {
      const next = await window.contextgit!.useProject(path);
      await reload();
      return next;
    },
    [reload],
  );

  /** Forget a project (its runs and commits stay); returns the remaining list. */
  const forget = useCallback(
    async (path: string) => {
      const remaining = await window.contextgit!.forgetProject(path);
      setProjects(remaining);
      await reload();
    },
    [reload],
  );

  return {
    projects,
    workspace,
    activePath: workspace?.path ?? null,
    error,
    choose,
    pickLocation,
    create,
    use,
    forget,
    reload,
  };
}
