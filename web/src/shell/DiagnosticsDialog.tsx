import { useEffect, useState } from "react";
import { HARNESSES, type HarnessCheck } from "../../shared/harnesses";
import Modal from "./Modal";
import { Field } from "./primitives";
import { LuCircleCheck, LuCircleMinus } from "react-icons/lu";

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
      Promise.all(HARNESSES.map((harness) => window.contextgit?.harnessCheck(harness.id).catch(() => ({ id: harness.id, command: harness.command ?? "shell", installed: false, path: null })))),
    ]).then(([info, values]) => {
      if (!alive) return;
      setRuntime(info ?? null);
      setChecks(values.filter((value): value is HarnessCheck => Boolean(value)));
    }).catch(() => { if (alive) setChecks([]); });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Modal title="Diagnostics" onClose={onClose}>
      <div className="cg-fields cg-diagnostics-system">
        <Field label="Platform">{runtime?.platform ?? "…"} · {runtime?.arch ?? "…"}</Field>
        <Field label="Shell"><span className="cg-mono">{runtime?.shell ?? "…"}</span></Field>
        <Field label="Backend">{(window.contextgit ? window.contextgit.getStatus().status.state === "ready" : backendAvailable) ? "Ready" : "Unavailable"}</Field>
      </div>
      <div className="cg-dock-group">
        <span className="cg-kicker">Terminal agents</span>
        <ul className="cg-diagnostics-agents">
          {checks.map((check) => (
            <li key={check.id} className="cg-inline cg-diagnostics-row">
              <span>{HARNESSES.find(agent => agent.id === check.id)?.label ?? check.id}</span>
              <span className={check.installed ? "cg-status-text-ok" : "cg-status-text-muted"}>
                {check.installed ? <LuCircleCheck aria-hidden="true" /> : <LuCircleMinus aria-hidden="true" />}
                {check.installed ? "Installed" : "Not found"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
