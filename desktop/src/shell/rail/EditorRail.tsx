import { useCallback, useEffect, useRef, useState } from "react";

import { api, type ProviderInfo } from "@/lib/api";
import type { EditorStatus } from "../../../shared/editor";

/** The Editor rail: the sidecar, the project folder, and the completion provider. */
export default function EditorRail({
  reloadKey,
  activePath,
  onStarted,
  onOpenFolder,
  onConnect,
}: {
  reloadKey: number;
  /** The active project folder; switching it reopens VS Code on the new folder. */
  activePath: string | null;
  onStarted: () => void;
  onOpenFolder: () => void;
  onConnect: () => void;
}) {
  const [status, setStatus] = useState<EditorStatus | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selection, setSelection] = useState<{ providerId: string; model: string }>({
    providerId: "",
    model: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const bridge = window.contextgit;
    if (bridge) {
      setStatus(await bridge.editorStatus());
      setSelection(await bridge.editorSelectionGet());
    }
    try {
      setProviders(await api.editorProviders());
    } catch {
      // the backend may still be starting
    }
  }, []);

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
    await load();
    onStarted();
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

  const connected = providers.filter((provider) => provider.has_key);

  // Default to the first connected provider so the choice is always explicit.
  useEffect(() => {
    const bridge = window.contextgit;
    if (!bridge || selection.providerId) return;
    const first = connected[0];
    if (!first) return;
    void bridge
      .editorSelectionSet({ providerId: first.id, model: first.default_model ?? "" })
      .then(setSelection);
  }, [connected, selection.providerId]);

  const choose = useCallback(
    async (provider: ProviderInfo) => {
      const bridge = window.contextgit;
      if (!bridge) return;
      setSelection(
        await bridge.editorSelectionSet({ providerId: provider.id, model: provider.default_model ?? "" }),
      );
      // Rewrite the sidecar settings so the extension picks the change up live.
      if (status?.running) await bridge.editorStart();
    },
    [status?.running],
  );

  const activeProvider = connected.find((provider) => provider.id === selection.providerId) ?? connected[0];
  const activeModel = selection.model || activeProvider?.default_model || "default";

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
      <button type="button" className="cg-row" onClick={onConnect}>
        <span className="cg-row-title">Connect AI provider…</span>
      </button>

      <div className="cg-rail-head">
        <h2>Completions</h2>
      </div>
      {connected.length === 0 ? (
        <p className="cg-empty-note cg-rail-search">
          No provider connected yet. Click “Connect AI provider…”.
        </p>
      ) : (
        <>
          {connected.map((provider) => (
            <button
              key={provider.id}
              type="button"
              className="cg-row"
              aria-current={activeProvider?.id === provider.id}
              title={provider.id}
              onClick={() => void choose(provider)}
            >
              <span className="cg-row-title">{provider.label}</span>
              <span className="cg-toolbar-spacer" />
              <span className="cg-view-sub">{provider.default_model ?? "default"}</span>
            </button>
          ))}
          <p className="cg-view-sub cg-rail-search">
            Inline completions use {activeProvider?.label} · {activeModel}.
          </p>
        </>
      )}

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
