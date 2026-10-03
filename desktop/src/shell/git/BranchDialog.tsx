import { useEffect, useRef, useState } from "react";

import { api, type Commit } from "@/lib/api";
import Modal from "../Modal";

/** Create a branch starting at the selected commit. */
export default function BranchDialog({
  commit,
  onCreated,
  onClose,
}: {
  commit: Commit;
  onCreated: (branch: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const branch = await api.createBranch(trimmed, commit.id);
      onCreated(branch.name);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the branch");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Branch from here"
      subtitle={commit.id.slice(0, 7)}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="cg-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="cg-btn"
            data-variant="primary"
            disabled={!name.trim() || busy}
            onClick={() => void create()}
          >
            {busy ? "Creating…" : "Create branch"}
          </button>
        </>
      }
    >
      <label className="cg-kicker" htmlFor="cg-branch-name">
        Branch name
      </label>
      <input
        id="cg-branch-name"
        className="cg-text-input"
        ref={inputRef}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void create();
          }
        }}
        placeholder="e.g. experiment/caching"
      />
      <p className="cg-empty-note">
        Starts at {commit.id.slice(0, 7)} and keeps this commit's history.
      </p>
      {error && <p className="cg-pane-error">{error}</p>}
    </Modal>
  );
}
