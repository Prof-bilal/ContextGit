import { useCallback, useEffect, useRef, useState } from "react";

import {
  harnessFor,
  type HarnessInstallPhase,
} from "../../../shared/harnesses";
import { AgentMark } from "../primitives";

const PHASE_LABEL: Record<HarnessInstallPhase, string> = {
  checking: "Checking…",
  installing: "Downloading…",
  verifying: "Finishing…",
  done: "Done",
  error: "Failed",
};

/**
 * Pre-flight gate shown instead of the terminal while a harness CLI is being
 * installed. Installing runs hidden in the main process — this only draws the
 * progress; when the binary is ready, `onReady` starts the PTY.
 */
export default function HarnessInstall({
  command,
  onReady,
}: {
  /** session.agent value (e.g. "cline"). */
  command: string;
  onReady: () => void;
}) {
  const harness = harnessFor(command);
  const bridge = window.contextgit;
  const [phase, setPhase] = useState<HarnessInstallPhase>("checking");
  const [line, setLine] = useState("Checking…");
  const [percent, setPercent] = useState(0.04);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Keep the latest callback without re-subscribing, and only fire once.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const readyRef = useRef(false);
  const ready = useCallback(() => {
    if (readyRef.current) return;
    readyRef.current = true;
    onReadyRef.current();
  }, []);

  useEffect(() => {
    // Not an auto-installable harness (or no bridge, e.g. the browser mock):
    // nothing to gate on, just start.
    if (!harness?.npmPackage || !bridge) {
      ready();
      return;
    }
    let alive = true;
    const off = bridge.onHarnessProgress((event) => {
      if (!alive || event.id !== harness.id) return;
      if (event.line) setLine(event.line);
      if (typeof event.percent === "number") setPercent(event.percent);
      if (event.phase === "done") {
        setPhase("done");
        setPercent(1);
        ready();
        return;
      }
      if (event.phase === "error") {
        setPhase("error");
        setError(event.error ?? "Install failed.");
        return;
      }
      setPhase(event.phase);
    });
    void (async () => {
      const check = await bridge.harnessCheck(harness.id);
      if (!alive) return;
      if (check.installed) {
        ready();
        return;
      }
      setPhase("installing");
      setLine(`Installing ${harness.label} with npm…`);
      await bridge.harnessInstall(harness.id);
    })();
    return () => {
      alive = false;
      off();
    };
  }, [harness, bridge, ready, attempt]);

  if (!harness) return null;

  const retry = () => {
    setError(null);
    setLine("Checking…");
    setPercent(0.04);
    setPhase("checking");
    readyRef.current = false;
    setAttempt((value) => value + 1);
  };

  const cancel = () => {
    if (harness.id) bridge?.harnessCancel(harness.id);
  };

  return (
    <section className="cg-install" aria-live="polite" aria-label={`Installing ${harness.label}`}>
      <div className="cg-install-head">
        <AgentMark agent={harness.id} label={harness.monogram} size="lg" />
        <div className="cg-install-copy">
          <h3>{harness.label} isn't installed</h3>
          <p>{phase === "error" ? error : line}</p>
        </div>
      </div>

      {phase !== "error" ? (
        <>
          <div className="cg-burn-bar cg-install-bar" data-active={phase !== "done"}>
            <span style={{ width: `${Math.round(percent * 100)}%` }} />
          </div>
          <div className="cg-install-foot">
            <span className="cg-install-phase">{PHASE_LABEL[phase]}</span>
            <button type="button" className="cg-btn cg-btn-sm" onClick={cancel}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div className="cg-install-foot">
          <button type="button" className="cg-btn cg-btn-sm" data-variant="primary" onClick={retry}>
            Retry
          </button>
          {harness.docsUrl && (
            <a className="cg-btn cg-btn-sm" href={harness.docsUrl} target="_blank" rel="noreferrer">
              Install docs
            </a>
          )}
          <span className="cg-install-phase">
            {harness.npmPackage ? `npm install -g ${harness.npmPackage}` : ""}
          </span>
        </div>
      )}
    </section>
  );
}
