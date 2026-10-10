import { useEffect, useState } from "react";
import { HARNESSES, type HarnessCheck } from "../../shared/harnesses";
import Modal from "./Modal";

export default function DiagnosticsDialog({
  backendAvailable,
  onClose,
}: {
  backendAvailable: boolean;
  onClose: () => void;
}) {
  const [runtime, setRuntime] = useState<import("../../shared/runtime").RuntimeInfo | null>(null);
  const [checks, setChecks] = useState<HarnessCheck[]>([]);

  useEffect(() => {
    let alive = true;
    void Promise.all([
      window.contextgit?.runtimeInfo(),
      Promise.all(HARNESSES.map((harness) => window.contextgit?.harnessCheck(harness.id))),
    ]).then(([info, values]) => {
      if (!alive) return;
      setRuntime(info ?? null);
      setChecks(values.filter((value): value is HarnessCheck => Boolean(value)));
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Modal title="Beta diagnostics" subtitle="Safe to attach to a bug report" onClose={onClose} size="lg">
      <dl className="cg-fields">
        <dt>Platform</dt><dd>{runtime?.platform ?? "…"} · {runtime?.arch ?? "…"}</dd>
        <dt>Shell</dt><dd className="cg-mono">{runtime?.shell ?? "…"}</dd>
        <dt>Backend</dt><dd>{backendAvailable ? "Ready" : "Unavailable"}</dd>
      </dl>
      <div className="cg-dock-group">
        <span className="cg-kicker">Terminal agents</span>
        <ul className="cg-plain-list">
          {checks.map((check) => (
            <li key={check.id} className="cg-inline cg-diagnostics-row">
              <span>{check.id}</span>
              <span className={check.installed ? "cg-status-text-ok" : "cg-status-text-muted"}>
                {check.installed ? "installed" : "not found"}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="cg-empty-note">Transcript capture is verified per agent; terminal launch alone does not guarantee native capture.</p>
    </Modal>
  );
}
