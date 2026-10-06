import Modal from "../Modal";
import type { Asset } from "../../../shared/assets";

/** A full-size preview for images, video and audio. */
export default function AssetPreview({
  asset,
  onClose,
}: {
  asset: Asset;
  onClose: () => void;
}) {
  const url = window.contextgit?.assetUrl(asset.id) ?? "";
  return (
    <Modal title={asset.name} subtitle={asset.kind} size="lg" onClose={onClose}>
      <div className="cg-asset-preview">
        {asset.kind === "image" && <img src={url} alt={asset.name} />}
        {asset.kind === "video" && <video src={url} controls autoPlay />}
        {asset.kind === "audio" && <audio src={url} controls autoPlay />}
        {(asset.kind === "doc" || asset.kind === "other") && (
          <p className="cg-empty-note">
            {asset.kind === "doc" ? "Document" : "File"} — use Reveal to open it with a system app.
          </p>
        )}
      </div>
    </Modal>
  );
}
