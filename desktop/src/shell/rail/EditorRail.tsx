import { useCallback, useEffect, useState } from "react";

import type { EditorStatus } from "../../../shared/editor";

/** The Editor rail: sidecar status, a start button and the project folder. */
export default function EditorRail({
  reloadKey,
  onStarted,
  onOpenFolder,
}: {
  reloadKey: number;
  onStarted: () => void;
  onOpenFolder: () => void;
}) {
  const [status, setStatus] = useState<EditorStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.contextgit?.editorStatus().then(setStatus);
  }, [reloadKey, onStarted]);

  const start = useCallback(async () => {
    const bridge = window.contextgit;
    if (!bridge) return;
    setBusy(true);
    setError(null);
    const result = await bridge.editorStart();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not start the editor");
      return;
    }
    setStatus(await bridge.editorStatus());
    onStarted();
  }, [onStarted]);

  return (
    <nav className="cg-rail" aria-label="Editor">
      <div className="cg-rail-head">
        <h2>Editor</h2>
      </div>
      <button
        type="button"
        className="cg-new-btn"
        disabled={busy}
        onClick={() => void start()}
      >
        {busy ? "Starting…" : status?.running ? "Restart editor" : "Start editor"}
      </button>
      <button type="button" className="cg-row" onClick={onOpenFolder}>
        <span className="cg-row-title">Open project folder…</span>
      </button>
      <div className="cg-rail-head">
        <h2>Status</h2>
      </div>
      <p className="cg-empty-note cg-rail-search">
        {status?.running
          ? `Running on ${status.url}`
          : status?.available
            ? "Not running."
            : "Editor not installed — run `npm run fetch:editor`."}
      </p>
      {error && (
        <p className="cg-pane-error" role="alert">
          {error}
        </p>
      )}
    </nav>
  );
}
