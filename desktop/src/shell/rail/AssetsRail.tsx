import { LuFolderPlus, LuSearch } from "react-icons/lu";

import type { AssetKind } from "../../../shared/assets";

export type AssetFilter = AssetKind | "all";

const KINDS: Array<{ value: AssetFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "image", label: "Images" },
  { value: "video", label: "Video" },
  { value: "audio", label: "Audio" },
  { value: "doc", label: "Docs" },
  { value: "other", label: "Other" },
];

/** The Assets rail: folders, type filters, search and tags. */
export default function AssetsRail({
  counts,
  kind,
  onKind,
  query,
  onQuery,
  folders,
  folderCounts,
  folder,
  onFolder,
  onNewFolder,
  tags,
  activeTag,
  onTag,
}: {
  counts: Record<AssetFilter, number>;
  kind: AssetFilter;
  onKind: (kind: AssetFilter) => void;
  query: string;
  onQuery: (query: string) => void;
  folders: string[];
  folderCounts: Record<string, number>;
  folder: string | null;
  onFolder: (folder: string | null) => void;
  onNewFolder: () => void;
  tags: { name: string; count: number }[];
  activeTag: string | null;
  onTag: (tag: string | null) => void;
}) {
  return (
    <nav className="cg-rail" aria-label="Assets">
      <div className="cg-rail-head">
        <h2>Assets</h2>
        <span className="cg-count">{counts.all}</span>
      </div>

      <div className="cg-rail-search">
        <LuSearch aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search assets"
          aria-label="Search assets"
        />
      </div>

      <div className="cg-rail-head">
        <h2>Folders</h2>
        <span className="cg-toolbar-spacer" />
        <button
          type="button"
          className="cg-icon-btn"
          aria-label="New folder"
          title="New folder"
          onClick={onNewFolder}
        >
          <LuFolderPlus aria-hidden="true" />
        </button>
      </div>
      <button
        type="button"
        className="cg-row"
        aria-current={folder === null}
        onClick={() => onFolder(null)}
      >
        <span className="cg-row-title">All assets</span>
        <span className="cg-toolbar-spacer" />
        <span className="cg-count">{counts.all}</span>
      </button>
      {folders.map((name) => (
        <button
          key={name}
          type="button"
          className="cg-row"
          aria-current={folder === name}
          title={name}
          onClick={() => onFolder(name)}
        >
          <span className="cg-row-title">{name}</span>
          <span className="cg-toolbar-spacer" />
          <span className="cg-count">{folderCounts[name] ?? 0}</span>
        </button>
      ))}

      <div className="cg-mini-seg cg-rail-filter" role="tablist" aria-label="Asset type">
        {KINDS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            role="tab"
            aria-selected={kind === entry.value}
            onClick={() => onKind(entry.value)}
          >
            {entry.label}
            {counts[entry.value] ? ` ${counts[entry.value]}` : ""}
          </button>
        ))}
      </div>

      {tags.length > 0 && (
        <>
          <div className="cg-rail-head">
            <h2>Tags</h2>
          </div>
          {tags.map((tag) => (
            <button
              key={tag.name}
              type="button"
              className="cg-row"
              aria-current={activeTag === tag.name}
              onClick={() => onTag(activeTag === tag.name ? null : tag.name)}
            >
              <span className="cg-row-title">#{tag.name}</span>
              <span className="cg-toolbar-spacer" />
              <span className="cg-count">{tag.count}</span>
            </button>
          ))}
        </>
      )}
    </nav>
  );
}
