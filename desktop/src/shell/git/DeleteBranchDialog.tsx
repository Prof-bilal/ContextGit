import { useState } from "react";

import { api } from "@/lib/api";
import Modal from "../Modal";

/** Confirm a branch delete. Commits survive; only the pointer goes. */
export default function DeleteBranchDialog({
  name,
  onDeleted,
  onClose,
}: {
  name: string;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteBranch(name);
      onDeleted();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete the branch");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Delete branch"
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
            {busy ? "Deleting…" : "Delete branch"}
          </button>
        </>
      }
    >
      <p className="cg-empty-note">
        This removes the <strong>{name}</strong> pointer only — every commit stays in the repository
        and is still reachable from other branches.
      </p>
      {error && <p className="cg-pane-error">{error}</p>}
    </Modal>
  );
}
