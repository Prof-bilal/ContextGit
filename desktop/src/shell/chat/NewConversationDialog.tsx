import { useState } from "react";

import { CHAT_MODES, type ChatMode } from "../../mock/chat";
import Modal from "../Modal";

export interface NewConversationInput {
  mode: ChatMode;
  /** Optional short label; the branch becomes "<mode>/<label or timestamp>". */
  label: string;
  /** An existing conversation to seed a summary from, or null for an empty start. */
  seedFrom: string | null;
}

function slug(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Start a conversation: pick its surface (mode), an optional label, and an
 * optional conversation to import a summary from. The new conversation is a
 * branch forked from the repo root, so it starts empty and isolated.
 */
export default function NewConversationDialog({
  defaultMode,
  sources,
  onCreate,
  onClose,
}: {
  defaultMode: ChatMode;
  sources: string[];
  onCreate: (input: NewConversationInput) => Promise<void>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<ChatMode>(defaultMode);
  const [label, setLabel] = useState("");
  const [seedFrom, setSeedFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = `${mode}/${slug(label) || "<timestamp>"}`;

  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onCreate({ mode, label: slug(label), seedFrom: seedFrom || null });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the conversation");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New conversation"
      subtitle="Starts empty — nothing leaks in from other conversations"
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
            disabled={busy}
            onClick={() => void create()}
          >
            {busy ? "Creating…" : "Create conversation"}
          </button>
        </>
      }
    >
      <span className="cg-kicker">Type</span>
      <div className="cg-mini-seg" role="tablist" aria-label="Conversation type">
        {CHAT_MODES.map((entry) => (
          <button
            key={entry.value}
            type="button"
            role="tab"
            aria-selected={mode === entry.value}
            title={entry.hint}
            onClick={() => setMode(entry.value)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <label className="cg-kicker" htmlFor="cg-convo-label">
        Label (optional)
      </label>
      <input
        id="cg-convo-label"
        className="cg-text-input"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        placeholder="e.g. auth refactor"
      />
      <p className="cg-empty-note">
        Branch: <span className="cg-mono">{preview}</span>
      </p>

      <label className="cg-kicker" htmlFor="cg-convo-seed">
        Import a summary from (optional)
      </label>
      <select
        id="cg-convo-seed"
        className="cg-text-input"
        value={seedFrom}
        onChange={(event) => setSeedFrom(event.target.value)}
      >
        <option value="">None — start empty</option>
        {sources.map((source) => (
          <option key={source} value={source}>
            {source}
          </option>
        ))}
      </select>

      {error && <p className="cg-pane-error">{error}</p>}
    </Modal>
  );
}
