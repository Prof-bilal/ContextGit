import { useState } from "react";

import Modal from "../Modal";

/** A small confirm dialog for the destructive Storage actions. */
export default function ConfirmDialog({
  title,
  subtitle,
  body,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  subtitle?: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      subtitle={subtitle}
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
            onClick={() => void run()}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      <p className="cg-empty-note">{body}</p>
      {error && <p className="cg-pane-error">{error}</p>}
    </Modal>
  );
}
