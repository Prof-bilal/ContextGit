import { useCallback, useEffect, useState } from "react";

import Shell from "./shell/Shell";
import ErrorBoundary from "./ErrorBoundary";
import type { BackendStatus } from "../shared/status";

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
    } finally {
      setRestarting(false);
    }
  }, []);

  if (backend.status.state === "starting") {
    return (
      <main className="backend-screen" aria-live="polite">
        <p className="backend-kicker">ContextGit</p>
        <h1>Starting local backend…</h1>
        <p className="backend-detail">Spawning the ContextGit API on {backend.apiBase}.</p>
      </main>
    );
  }

  if (backend.status.state === "error") {
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
    <ErrorBoundary>
      <Shell />
    </ErrorBoundary>
  );
}
