import { LuFile, LuFileAudio, LuFileText, LuFilm } from "react-icons/lu";

import type { Asset } from "../../../shared/assets";

function KindIcon({ kind }: { kind: Asset["kind"] }) {
  if (kind === "video") return <LuFilm aria-hidden="true" />;
  if (kind === "audio") return <LuFileAudio aria-hidden="true" />;
  if (kind === "doc") return <LuFileText aria-hidden="true" />;
  return <LuFile aria-hidden="true" />;
}

/** One tile in the asset gallery. */
export default function AssetCard({
  asset,
  selected,
  onSelect,
  onOpen,
}: {
  asset: Asset;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const url = window.contextgit?.assetUrl(asset.id) ?? "";
  return (
    <button
      type="button"
      className="cg-card"
      aria-current={selected}
      title={asset.name}
      onClick={onSelect}
      onDoubleClick={onOpen}
    >
      <span className="cg-card-thumb" data-kind={asset.kind}>
        {asset.kind === "image" ? (
          <img src={url} alt="" loading="lazy" />
        ) : (
          <KindIcon kind={asset.kind} />
        )}
      </span>
      <span className="cg-card-name">{asset.name}</span>
      <span className="cg-card-meta">
        {asset.kind}
        {asset.tags.length > 0 ? ` · ${asset.tags.length} tag${asset.tags.length === 1 ? "" : "s"}` : ""}
      </span>
    </button>
  );
}
