import Modal from "../Modal";
import type { Asset } from "../../../shared/assets";

/** Confirmation before an asset is removed from the library. */
export default function DeleteAssetDialog({
  asset,
  onConfirm,
  onClose,
}: {
  asset: Asset;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title="Delete asset"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="cg-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="cg-btn" data-variant="danger" onClick={onConfirm}>
            Delete asset
          </button>
        </>
      }
    >
      <p>
        Delete <strong>{asset.name}</strong> from the library? The stored copy is removed and this
        cannot be undone.
      </p>
    </Modal>
  );
}
