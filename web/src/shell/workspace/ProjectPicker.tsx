import { useState } from "react";

import type { Workspace } from "../../../shared/workspace";
import Modal from "../Modal";

/**
 * Choose the project folder: open an existing folder on the computer, or create
 * a new one. New terminals and agents start in the chosen folder.
 */
export default function ProjectPicker({
  workspace,
  onChoose,
  onPickLocation,
  onCreate,
  onClose,
}: {
  workspace: Workspace | null;
  onChoose: () => Promise<Workspace | null>;
  onPickLocation: () => Promise<string | null>;
  onCreate: (parent: string, name: string) => Promise<Workspace>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"browse" | "create">("browse");
  const [location, setLocation] = useState(workspace?.parent ?? "");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await onChoose();
      if (next) onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open the folder picker");
    } finally {
      setBusy(false);
    }
  };

  const pickLocation = async () => {
    setError(null);
    try {
      const picked = await onPickLocation();
      if (picked) setLocation(picked);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open the folder picker");
    }
  };

  const create = async () => {
    const folder = name.trim();
    if (!folder || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(location, folder);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the folder");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Project folder"
      subtitle="Where new terminals and agents run"
      onClose={onClose}
      footer={
        mode === "browse" ? (
          <>
            <button type="button" className="cg-btn" onClick={onClose}>
              Cancel
            </button>
            <span className="cg-toolbar-spacer" />
            <button type="button" className="cg-btn" onClick={() => setMode("create")}>
              New folder…
            </button>
            <button
              type="button"
              className="cg-btn"
              data-variant="primary"
              disabled={busy}
              onClick={() => void choose()}
            >
              {busy ? "Opening…" : "Choose folder…"}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="cg-btn"
              onClick={() => {
                setMode("browse");
                setError(null);
              }}
            >
              Back
            </button>
            <span className="cg-toolbar-spacer" />
            <button
              type="button"
              className="cg-btn"
              data-variant="primary"
              disabled={busy || !name.trim() || !location}
              onClick={() => void create()}
            >
              {busy ? "Creating…" : "Create & use"}
            </button>
          </>
        )
      }
    >
      {mode === "browse" ? (
        <>
          <dl className="cg-field">
            <dt>Current</dt>
            <dd>{workspace ? <span className="cg-path">{workspace.path}</span> : "Loading…"}</dd>
          </dl>
          <p className="cg-empty-note">
            Pick any folder on your computer, or create a new one. Terminals and agents you start from
            now on open in this folder.
          </p>
          {error && <p className="cg-pane-error">{error}</p>}
        </>
      ) : (
        <>
          <label className="cg-kicker" htmlFor="cg-project-location">
            Location
          </label>
          <div className="cg-inline">
            <input
              id="cg-project-location"
              className="cg-text-input"
              value={location}
              readOnly
              placeholder="Choose a location…"
            />
            <button type="button" className="cg-btn" onClick={() => void pickLocation()}>
              Change…
            </button>
          </div>
          <label className="cg-kicker" htmlFor="cg-project-name">
            Folder name
          </label>
          <input
            id="cg-project-name"
            className="cg-text-input"
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void create();
              }
            }}
            placeholder="e.g. my-new-project"
          />
          <p className="cg-empty-note">Creates the folder inside the location above and starts using it.</p>
          {error && <p className="cg-pane-error">{error}</p>}
        </>
      )}
    </Modal>
  );
}
