import { useState } from "react";

import Modal from "../Modal";

/** Create a folder in the asset library (slash-separated for nesting). */
export default function NewFolderDialog({
  onCreate,
  onClose,
}: {
  onCreate: (folder: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const trimmed = name.trim();

  return (
    <Modal
      title="New folder"
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
            disabled={!trimmed}
            onClick={() => void onCreate(trimmed).then(onClose)}
          >
            Create folder
          </button>
        </>
      }
    >
      <label className="cg-field-label" htmlFor="cg-new-folder">
        Folder name
      </label>
      <input
        id="cg-new-folder"
        className="cg-input"
        value={name}
        placeholder="e.g. Logos or Marketing/Q3"
        onChange={(event) => setName(event.target.value)}
      />
    </Modal>
  );
}
