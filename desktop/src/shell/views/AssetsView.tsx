import { LuFolderUp, LuPlus, LuSparkles } from "react-icons/lu";

import type { Asset } from "../../../shared/assets";
import AssetCard from "../assets/AssetCard";

/** The Assets view: a gallery of the filtered assets, with import + agent actions. */
export default function AssetsView({
  items,
  selectedId,
  loading,
  error,
  folder,
  onSelect,
  onOpen,
  onImport,
  onImportFolder,
  onAgent,
}: {
  items: Asset[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  folder: string | null;
  onSelect: (id: string) => void;
  onOpen: (asset: Asset) => void;
  onImport: () => Promise<unknown>;
  onImportFolder: () => Promise<unknown>;
  onAgent: () => void;
}) {
  return (
    <>
      <div className="cg-view-toolbar">
        <h1>Assets</h1>
        <span className="cg-view-sub">
          {folder ? `${folder} · ` : ""}
          {items.length} item{items.length === 1 ? "" : "s"}
        </span>
        <span className="cg-toolbar-spacer" />
        <button
          type="button"
          className="cg-btn"
          data-variant="primary"
          onClick={onAgent}
          title="Manage assets with the AI agent"
        >
          <LuSparkles aria-hidden="true" /> AI agent
        </button>
        <button type="button" className="cg-btn" onClick={() => void onImport()}>
          <LuPlus aria-hidden="true" /> Import
        </button>
        <button type="button" className="cg-btn" onClick={() => void onImportFolder()}>
          <LuFolderUp aria-hidden="true" /> Import folder
        </button>
      </div>
      <div className="cg-view-body">
        {error && (
          <p className="cg-pane-error" role="alert">
            {error}
          </p>
        )}
        {!error && items.length === 0 && (
          <p className="cg-empty-note">
            No assets here. Import images, video, audio or documents — or a whole folder — and the
            AI agent can organise them.
          </p>
        )}
        {items.length > 0 && (
          <div className="cg-gallery">
            {items.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                selected={asset.id === selectedId}
                onSelect={() => onSelect(asset.id)}
                onOpen={() => onOpen(asset)}
              />
            ))}
          </div>
        )}
        {loading && items.length === 0 && <p className="cg-empty-note">Loading…</p>}
      </div>
    </>
  );
}
