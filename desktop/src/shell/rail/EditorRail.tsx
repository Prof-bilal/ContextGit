import { useCallback, useEffect, useRef, useState } from "react";

import type { EditorStatus } from "../../../shared/editor";

/** The Editor rail: the sidecar, the project folder and its status. */
export default function EditorRail({
  reloadKey,
  activePath,
  onStarted,
  onOpenFolder,
}: {
  reloadKey: number;
  /** The active project folder; switching it reopens VS Code on the new folder. */
  activePath: string | null;
  onStarted: () => void;
  onOpenFolder: () => void;
}) {
  const [status, setStatus] = useState<EditorStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const bridge = window.contextgit;
    try {
      if (bridge) setStatus(await bridge.editorStatus());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read editor status");
    }
  }, []);

  const start = useCallback(async () => {
    const bridge = window.contextgit;
    if (!bridge) return;
    setBusy(true);
    setError(null);
    try {
      const result = await bridge.editorStart();
      if (!result.ok) {
        setError(result.error ?? "Could not start the editor");
        return;
      }
      await load();
      onStarted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the editor");
    } finally {
      setBusy(false);
    }
  }, [load, onStarted]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  // Switching the project folder reopens VS Code on it (the sidecar restarts).
  const folderRef = useRef<string | null>(activePath);
  useEffect(() => {
    const changed =
      activePath !== null && folderRef.current !== null && activePath !== folderRef.current;
    folderRef.current = activePath;
    if (changed && status?.running) void start();
  }, [activePath, status?.running, start]);

  return (
    <nav className="cg-rail" aria-label="Editor">
      <div className="cg-rail-head">
        <h2>Editor</h2>
      </div>
      <button type="button" className="cg-new-btn" disabled={busy} onClick={() => void start()}>
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
