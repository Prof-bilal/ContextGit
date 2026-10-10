import { useEffect, useMemo, useState } from "react";
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
      const timer = window.setTimeout(() => setStatus(current => current?.state === "up-to-date" ? null : current), 3500);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [status?.state]);

  const visible = useMemo(() => {
    if (!status || hidden) return false;
    if (status.state === "available" || status.state === "downloading" || status.state === "downloaded") return true;
    return status.state === "error" && status.manual === true;
  }, [hidden, status]);
  if (!visible || !status) return null;

  const later = () => {
    if (status.version) {
      try { localStorage.setItem(`contextgit-update-dismissed:${status.version}`, "1"); } catch { /* storage is optional */ }
    }
    setHidden(true);
  };
  const download = () => {
    if (status.supported === false) void bridge?.openUpdateRelease();
    else void bridge?.downloadUpdate();
  };
  const retry = () => void bridge?.checkForUpdates();

  return (
    <div className="cg-update-banner" role="status" aria-live="polite">
      <div className="cg-update-copy">
        <strong>ContextGit {status.state === "error" ? "update check" : "update"}</strong>
        <span>
          {status.state === "available" && <>Version {status.version} is available (current {status.currentVersion}).</>}
          {status.state === "downloading" && <>Downloading version {status.version}…</>}
          {status.state === "downloaded" && <>Version {status.version} is ready to install.</>}
          {status.state === "error" && <>{status.message ?? "GitHub could not be reached."}</>}
        </span>
        {status.state === "downloading" && <progress className="cg-update-progress" max={100} value={status.percent ?? 0} />}
      </div>
      <div className="cg-update-actions">
        {status.state === "available" && <button className="cg-btn cg-btn-sm" onClick={download}>{status.supported === false ? "Open release downloads" : "Download update"}</button>}
        {status.state === "downloaded" && <button className="cg-btn cg-btn-sm" onClick={() => void bridge?.installUpdate()}>Restart and install</button>}
        {status.state === "error" && <button className="cg-btn cg-btn-sm" onClick={retry}>Retry</button>}
        <button className="cg-btn cg-btn-sm" onClick={later}>Later</button>
      </div>
    </div>
  );
}

export function UpdateCheckButton() {
  const [checking, setChecking] = useState(false);
  const update = async () => {
    if (!window.contextgit) return;
    setChecking(true);
    try {
      let result = await window.contextgit.checkForUpdates();
      if (result.state === "available") {
        if (result.supported === false) {
          await window.contextgit.openUpdateRelease();
        } else {
          result = await window.contextgit.downloadUpdate();
          if (result.state === "downloaded") await window.contextgit.installUpdate();
        }
      }
    } finally { setChecking(false); }
  };
  return <button type="button" className="cg-update-check" onClick={() => void update()} disabled={checking}>{checking ? "Updating…" : "Update app"}</button>;
}
