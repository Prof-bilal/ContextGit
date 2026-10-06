import { useState } from "react";

import { api, type Message } from "@/lib/api";
import { Chip } from "../primitives";

/** Rough token estimate for staged text (same ~4 chars/token as the backend). */
function estimateTokens(text: string): number {
  return Math.round(text.length / 4);
}

/**
 * The "diff space": what a conversation has produced but not yet committed —
 * for every mode (chat turns, a kept council answer, a research artifact, an
 * image prompt). Commit lands it on the branch; undo/clear remove it.
 */
export default function PendingChanges({
  sessionId,
  staged,
  onChanged,
}: {
  sessionId: string | null;
  staged: Message[];
  onChanged: () => void;
}) {
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      setSummary("");
      setError(null);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Staging action failed");
    } finally {
      setBusy(false);
    }
  };

  const total = staged.reduce((sum, message) => sum + estimateTokens(message.content), 0);

  return (
    <section className="cg-section" aria-label="Pending changes">
      <header className="cg-block-head">
        <span className="cg-kicker">Pending changes</span>
        <span className="cg-toolbar-spacer" />
        {staged.length > 0 && <Chip tone="warn">{staged.length} staged</Chip>}
      </header>

      {!sessionId && (
        <p className="cg-empty-note">
          This conversation has no staging session, so turns commit directly.
        </p>
      )}

      {sessionId && staged.length === 0 && (
        <p className="cg-empty-note">Nothing staged — send a message to stage a turn.</p>
      )}

      {sessionId && staged.length > 0 && (
        <>
          <ul className="cg-diff">
            {staged.map((message, index) => (
              <li key={index} data-change="added">
                <span className="cg-diff-sign" aria-hidden="true">
                  +
                </span>
                <span className="cg-diff-kind">{message.role}</span>
                <span className="cg-diff-text">{message.content}</span>
              </li>
            ))}
          </ul>
          <div className="cg-tags">
            <Chip>≈{total.toLocaleString()} tokens</Chip>
            <Chip>not committed</Chip>
          </div>
          <input
            className="cg-text-input"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="Commit summary (optional)"
            aria-label="Commit summary"
          />
          <div className="cg-install-foot">
            <button
              type="button"
              className="cg-btn"
              data-variant="primary"
              disabled={busy}
              onClick={() => void run(() => api.commitStaged(sessionId, summary.trim() || undefined))}
            >
              {busy ? "Committing…" : `Commit ${staged.length}`}
            </button>
            <button
              type="button"
              className="cg-btn cg-btn-sm"
              disabled={busy}
              onClick={() => void run(() => api.unstage(sessionId, true))}
            >
              Undo last
            </button>
            <button
              type="button"
              className="cg-btn cg-btn-sm"
              disabled={busy}
              onClick={() => void run(() => api.unstage(sessionId))}
            >
              Clear
            </button>
          </div>
        </>
      )}

      {error && <p className="cg-pane-error">{error}</p>}
    </section>
  );
}
