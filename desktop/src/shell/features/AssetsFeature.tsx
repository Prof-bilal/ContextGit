import { useMemo, useState } from "react";
import type { Asset } from "../../../shared/assets";
import AssetsRail, { type AssetFilter } from "../rail/AssetsRail";
import AssetsView from "../views/AssetsView";
import AssetDetails from "../assets/AssetDetails";
import AssetPreview from "../assets/AssetPreview";
import DeleteAssetDialog from "../assets/DeleteAssetDialog";
import AssetAgentPanel from "../assets/AssetAgentPanel";
import NewFolderDialog from "../assets/NewFolderDialog";
import { useAssets } from "../assets/useAssets";
import { useWorkbench } from "../WorkbenchContext";
import { useFeatureAction } from "../useFeatureAction";
import { FeaturePorts } from "../FeaturePorts";


export default function AssetsFeature() {
  const { tab, overlayOpen } = useWorkbench();
  const assets = useAssets();
  const { error: actionError, run: runAction } = useFeatureAction();

  const [assetId, setAssetId] = useState<string | null>(null);

  const [assetKind, setAssetKind] = useState<AssetFilter>("all");

  const [assetQuery, setAssetQuery] = useState("");

  const [assetTag, setAssetTag] = useState<string | null>(null);

  const [assetPreview, setAssetPreview] = useState<Asset | null>(null);

  const [assetDelete, setAssetDelete] = useState<Asset | null>(null);

  const [assetFolder, setAssetFolder] = useState<string | null>(null);

  const [agentOpen, setAgentOpen] = useState(false);

  const [newFolderOpen, setNewFolderOpen] = useState(false);

  const assetCounts = useMemo<Record<AssetFilter, number>>(() => {
    const counts: Record<AssetFilter, number> = {
      all: assets.assets.length,
      image: 0,
      video: 0,
      audio: 0,
      doc: 0,
      other: 0,
    };
    for (const asset of assets.assets) counts[asset.kind] += 1;
    return counts;
  }, [assets.assets]);

  const assetTags = useMemo(() => {
    const map = new Map<string, number>();
    for (const asset of assets.assets) {
      for (const tag of asset.tags) map.set(tag, (map.get(tag) ?? 0) + 1);
    }
    return [...map.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [assets.assets]);

  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const folder of assets.folders) {
      counts[folder] = assets.assets.filter(
        (asset) => asset.folder === folder || asset.folder.startsWith(`${folder}/`),
      ).length;
    }
    return counts;
  }, [assets.assets, assets.folders]);

  const filteredAssets = useMemo(() => {
    const query = assetQuery.trim().toLowerCase();
    return assets.assets.filter((asset) => {
      if (
        assetFolder !== null &&
        !(asset.folder === assetFolder || asset.folder.startsWith(`${assetFolder}/`))
      ) {
        return false;
      }
      if (assetKind !== "all" && asset.kind !== assetKind) return false;
      if (assetTag && !asset.tags.includes(assetTag)) return false;
      if (
        query &&
        !asset.name.toLowerCase().includes(query) &&
        !asset.tags.some((tag) => tag.toLowerCase().includes(query))
      ) {
        return false;
      }
      return true;
    });
  }, [assets.assets, assetFolder, assetKind, assetTag, assetQuery]);

  const selectedAsset = assets.assets.find((asset) => asset.id === assetId) ?? null;
  const rail = () => {
    return (
      <AssetsRail
        counts={assetCounts}
        kind={assetKind}
        onKind={setAssetKind}
        query={assetQuery}
        onQuery={setAssetQuery}
        folders={assets.folders}
        folderCounts={folderCounts}
        folder={assetFolder}
        onFolder={setAssetFolder}
        onNewFolder={() => setNewFolderOpen(true)}
        tags={assetTags}
        activeTag={assetTag}
        onTag={setAssetTag}
      />
    );
  };

  const view = () => {
    return (
      <AssetsView
        items={filteredAssets}
        selectedId={assetId}
        loading={assets.loading}
        error={assets.error}
        folder={assetFolder}
        onSelect={setAssetId}
        onOpen={setAssetPreview}
        onImport={() => runAction(assets.importAssets)}
        onImportFolder={() => runAction(assets.importFolder)}
        onAgent={() => setAgentOpen(true)}
      />
    );
  };

  const dock = () => {
    return selectedAsset ? (
      <AssetDetails
        asset={selectedAsset}
        folders={assets.folders}
        onUpdate={(patch) => runAction(() => assets.update(selectedAsset.id, patch))}
        onReveal={() => void runAction(() => window.contextgit?.assetsReveal(selectedAsset.id))}
        onDelete={() => setAssetDelete(selectedAsset)}
      />
    ) : (
      <p className="cg-empty-note">Select an asset to inspect it.</p>
    );
  };

  const dialogs = () => <>{assetPreview && (
    <AssetPreview asset={assetPreview} onClose={() => setAssetPreview(null)} />
  )}
    {assetDelete && (
      <DeleteAssetDialog
        asset={assetDelete}
        onConfirm={() => {
          const id = assetDelete.id;
          setAssetDelete(null);
          if (assetId === id) setAssetId(null);
          void runAction(() => assets.remove(id));
        }}
        onClose={() => setAssetDelete(null)}
      />
    )}
    {newFolderOpen && (
      <NewFolderDialog
        onCreate={(folder) => assets.createFolder(folder)}
        onClose={() => setNewFolderOpen(false)}
      />
    )}
    {agentOpen && (
      <AssetAgentPanel
        assets={assets.assets}
        onChanged={assets.refresh}
        onClose={() => setAgentOpen(false)}
      />
    )}</>;
  return <FeaturePorts id="assets"
    title={"Asset"}
    notice={actionError}
    rail={rail}
    view={view}
    dock={dock}
    dialogs={dialogs}
    onDismissDialogs={() => { setAssetPreview(null); setAssetDelete(null); setNewFolderOpen(false); setAgentOpen(false); }}
    hasModal={assetPreview !== null || assetDelete !== null || newFolderOpen || agentOpen} />;
}
