import { useEffect, useRef, useState } from "react";
import type { UpdateStatus } from "../shared/update";

function dismissed(version: string): boolean {
  try { return localStorage.getItem(`contextgit-update-dismissed:${version}`) === "1"; } catch { return false; }
}

export function UpdateBanner() {
  const bridge = window.contextgit;
  const [status, setStatus] = useState<UpdateStatus | null>(() => bridge?.getUpdateStatus() ?? null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    return bridge.onUpdateStatus(next => {
      setStatus(next);
      setHidden(next.state === "available" && Boolean(next.version) && !next.manual && dismissed(next.version!));
    });
  }, [bridge]);

  useEffect(() => {
    if (status?.state === "up-to-date") {
      const timer = window.setTimeout(() => setStatus(current => current?.state === "up-to-date" ? null : current), 6000);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [status?.state]);

  const visible = (() => {
    if (!status || hidden) return false;
    if (status.state === "available" || status.state === "downloading" || status.state === "downloaded") return true;
    return ["checking", "up-to-date", "error"].includes(status.state) && status.manual === true;
  })();
  if (!visible || !status) return null;

  const later = () => {
    if (status.version) {
      try { localStorage.setItem(`contextgit-update-dismissed:${status.version}`, "1"); } catch { /* storage is optional */ }
    }
    setHidden(true);
  };
  const download = async () => {
    try {
      if (status.supported === false) await bridge?.openUpdateRelease();
      else await bridge?.downloadUpdate();
    } catch (cause) { setStatus({ ...status, state: "error", manual: true, message: cause instanceof Error ? cause.message : String(cause) }); }
  };
  const retry = () => void bridge?.checkForUpdates();

  return (
    <div className="cg-update-banner" role="status" aria-live="polite">
      <div className="cg-update-copy">
        <strong>ContextGit {status.state === "error" ? "update check" : "update"}</strong>
        <span>
          {status.state === "checking" && <>Checking GitHub for updates…</>}
          {status.state === "up-to-date" && <>{status.message ?? `You are up to date (${status.currentVersion}).`}</>}
          {status.state === "available" && <>Version {status.version} is available (current {status.currentVersion}).</>}
          {status.state === "downloading" && <>Downloading version {status.version}…</>}
          {status.state === "downloaded" && <>Version {status.version} is ready to install.</>}
          {status.state === "error" && <>{status.message ?? "GitHub could not be reached."}</>}
        </span>
        {status.state === "available" && status.message && <small>{status.message}</small>}
        {status.state === "downloading" && <progress className="cg-update-progress" max={100} value={status.percent ?? 0} />}
      </div>
      <div className="cg-update-actions">
        {status.state === "available" && <button className="cg-btn cg-btn-sm" onClick={() => void download()}>{status.supported === false ? "Open release downloads" : "Download update"}</button>}
        {status.state === "downloaded" && <button className="cg-btn cg-btn-sm" onClick={() => void bridge?.installUpdate()}>Restart and install</button>}
        {status.state === "error" && <><button className="cg-btn cg-btn-sm" onClick={retry}>Retry</button><button className="cg-btn cg-btn-sm" onClick={() => void download()}>Open release downloads</button></>}
        <button className="cg-btn cg-btn-sm" onClick={later}>{status.state === "available" ? "Later" : "Dismiss"}</button>
      </div>
    </div>
  );
}

export function UpdateCheckButton() {
  const [checking, setChecking] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => window.contextgit?.onUpdateStatus(status => setChecking(status.state === "checking" || status.state === "downloading")), []);
  const update = async () => {
    if (pending.current) return;
    if (!window.contextgit) { setError("Update checks are available in the desktop app. Open GitHub releases to download the app."); return; }
    pending.current = true; setChecking(true); setError(null);
    try {
      await window.contextgit.checkForUpdates();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally {
      pending.current = false;
      const state = window.contextgit?.getUpdateStatus().state;
      setChecking(state === "checking" || state === "downloading");
    }
  };
  return <><button type="button" className="cg-update-check" onClick={() => void update()} disabled={checking} aria-busy={checking}>{checking ? "Checking…" : "Update app"}</button>{error && <span className="cg-update-check-error" role="alert">{error}</span>}</>;
}
