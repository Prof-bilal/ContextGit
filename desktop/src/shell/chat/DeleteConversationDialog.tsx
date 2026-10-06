import { useState } from "react";

import Modal from "../Modal";

/** Confirm deleting a conversation (its branch pointer + chat session). */
export default function DeleteConversationDialog({
  name,
  onConfirm,
  onClose,
}: {
  name: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete the conversation");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Delete conversation"
      subtitle={name}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="cg-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="cg-btn"
            data-variant="danger"
            disabled={busy}
            onClick={() => void remove()}
          >
            {busy ? "Deleting…" : "Delete conversation"}
          </button>
        </>
      }
    >
      <p className="cg-empty-note">
        This removes the <strong>{name}</strong> conversation and its staging buffer. Every commit
        stays in the repository and is still reachable from other branches.
      </p>
      {error && <p className="cg-pane-error">{error}</p>}
    </Modal>
  );
}
