import { useCallback, useEffect, useState } from "react";

import Shell from "./shell/Shell";
import ErrorBoundary from "./ErrorBoundary";
import type { BackendStatus } from "../shared/status";
import { UpdateBanner } from "./UpdateBanner";

const fallback = { status: { state: "ready" } as BackendStatus, apiBase: "http://127.0.0.1:8756" };

function readBridge(): { status: BackendStatus; apiBase: string } {
  return window.contextgit?.getStatus() ?? fallback;
}

/**
 * Electron shell: health-gate on the local backend, then mount the workspace.
 * (In a plain browser there is no bridge, so it renders directly for UI work.)
 */
export default function App() {
  const [backend, setBackend] = useState(readBridge);
  const [restarting, setRestarting] = useState(false);
  const [workspaceMounted, setWorkspaceMounted] = useState(() => readBridge().status.state === "ready");
  useEffect(() => {
    if (backend.status.state === "ready") setWorkspaceMounted(true);
  }, [backend.status]);

  useEffect(() => {
    const bridge = window.contextgit;
    if (!bridge) return;
    return bridge.onStatus((status) => setBackend({ status, apiBase: bridge.apiBase }));
  }, []);

  const restart = useCallback(async () => {
    const bridge = window.contextgit;
    if (!bridge) return;
    setRestarting(true);
    try {
      setBackend(await bridge.restartBackend());
    } catch (cause) {
      setBackend({ apiBase: bridge.apiBase, status: { state: "error", message: cause instanceof Error ? cause.message : "Backend restart failed." } });
    } finally {
      setRestarting(false);
    }
  }, []);

  if (!workspaceMounted && backend.status.state === "starting") {
    return (
      <main className="backend-screen" aria-live="polite">
        <p className="backend-kicker">ContextGit</p>
        <h1>Starting local backend…</h1>
        <p className="backend-detail">Spawning the ContextGit API on {backend.apiBase}.</p>
      </main>
    );
  }

  if (!workspaceMounted && backend.status.state === "error") {
    return (
      <main className="backend-screen" aria-live="assertive">
        <p className="backend-kicker">ContextGit</p>
        <h1>Backend failed</h1>
        <pre className="backend-detail">{backend.status.message}</pre>
        <button type="button" onClick={() => void restart()} disabled={restarting}>
          {restarting ? "Restarting…" : "Restart backend"}
        </button>
      </main>
    );
  }

  return (
    <>
      <UpdateBanner />
      {backend.status.state !== "ready" && (
        <div className="cg-banner" role="alert">
          {backend.status.state === "error" ? backend.status.message : "Reconnecting to the backend…"}
          <button className="cg-btn cg-btn-sm" onClick={() => void restart()} disabled={restarting}>
            {restarting ? "Reconnecting…" : "Reconnect backend"}
          </button>
        </div>
      )}
      <ErrorBoundary><Shell backendAvailable={backend.status.state === "ready"} /></ErrorBoundary>
    </>
  );
}
