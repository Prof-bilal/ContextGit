import { useCallback, useEffect, useState } from "react";

import type { AgentAction, AgentActionResult, Asset, AssetPatch } from "../../../shared/assets";

export interface AssetsState {
  assets: Asset[];
  folders: string[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  importAssets: () => Promise<{ imported: number; skipped: number } | null>;
  importFolder: () => Promise<{ imported: number; skipped: number } | null>;
  createFolder: (folder: string) => Promise<void>;
  move: (ids: string[], folder: string) => Promise<void>;
  update: (id: string, patch: AssetPatch) => Promise<void>;
  remove: (id: string) => Promise<void>;
  apply: (actions: AgentAction[]) => Promise<AgentActionResult[]>;
}

/** The app-level asset library: catalog, folders, import, edits and delete. */
export function useAssets(): AssetsState {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const bridge = window.contextgit;
    if (!bridge) return;
    setLoading(true);
    try {
      const catalog = await bridge.assetsCatalog();
      setAssets(catalog.assets);
      setFolders(catalog.folders);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the asset library");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const importAssets = useCallback(async () => {
    const bridge = window.contextgit;
    if (!bridge) return null;
    const result = await bridge.assetsImport();
    await refresh();
    return { imported: result.imported.length, skipped: result.skipped.length };
  }, [refresh]);

  const importFolder = useCallback(async () => {
    const bridge = window.contextgit;
    if (!bridge) return null;
    const result = await bridge.assetsImportFolder();
    await refresh();
    return { imported: result.imported.length, skipped: result.skipped.length };
  }, [refresh]);

  const createFolder = useCallback(
    async (folder: string) => {
      await window.contextgit?.assetsCreateFolder(folder);
      await refresh();
    },
    [refresh],
  );

  const move = useCallback(
    async (ids: string[], folder: string) => {
      await window.contextgit?.assetsMove(ids, folder);
      await refresh();
    },
    [refresh],
  );

  const update = useCallback(
    async (id: string, patch: AssetPatch) => {
      await window.contextgit?.assetsUpdate(id, patch);
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await window.contextgit?.assetsDelete(id);
      await refresh();
    },
    [refresh],
  );

  const apply = useCallback(
    async (actions: AgentAction[]) => {
      const bridge = window.contextgit;
      if (!bridge) return [];
      const results = await bridge.assetsApply(actions);
      await refresh();
      return results;
    },
    [refresh],
  );

  return {
    assets,
    folders,
    loading,
    error,
    refresh,
    importAssets,
    importFolder,
    createFolder,
    move,
    update,
    remove,
    apply,
  };
}
