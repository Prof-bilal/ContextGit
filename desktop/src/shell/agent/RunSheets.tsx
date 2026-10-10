import type { AgentRun, NamedAgent } from "../../mock/fixtures";
import Modal from "../Modal";
import { Chip } from "../primitives";
import { diffCounts, runDiff, type DiffChange } from "./runDiff";
import { runSteps, shortHash } from "./runSteps";

const SIGN: Record<DiffChange, string> = { added: "+", changed: "~", removed: "−" };
const CHANGES: DiffChange[] = ["added", "changed", "removed"];

/** What this run changed in the context DAG. */
export function RunDiffSheet({
  run,
  agent,
  onClose,
}: {
  run: AgentRun;
  agent: NamedAgent;
  onClose: () => void;
}) {
  const entries = runDiff(run, agent);
  const counts = diffCounts(entries);

  return (
    <Modal
      title="Context diff"
      subtitle={run.summary}
      onClose={onClose}
      footer={
        <button type="button" className="cg-btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="cg-tags">
        <Chip tone="ok">+{counts.added} added</Chip>
        <Chip tone="signal">~{counts.changed} changed</Chip>
        {counts.removed > 0 && <Chip tone="warn">−{counts.removed} removed</Chip>}
      </div>

      {CHANGES.map((change) => {
        const rows = entries.filter((entry) => entry.change === change);
        if (rows.length === 0) return null;
        return (
          <section key={change} className="cg-diff-group">
            <h3 className="cg-kicker">{change}</h3>
            <ul className="cg-diff">
              {rows.map((row, index) => (
                <li key={index} data-change={change}>
                  <span className="cg-diff-sign" aria-hidden="true">
                    {SIGN[change]}
                  </span>
                  <span className="cg-diff-kind">{row.kind}</span>
                  <span className="cg-diff-text">{row.text}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <p className="cg-empty-note">
        Sample diff — derived from this agent's memory, not a real commit.
      </p>
    </Modal>
  );
}

/** The full run: stats, the whole step log, and what it produced. */
export function RunSheet({
  run,
  agent,
  onClose,
}: {
  run: AgentRun;
  agent: NamedAgent;
  onClose: () => void;
}) {
  const steps = runSteps(run);
  const checkpoint = shortHash(`${run.id}-checkpoint`);

  return (
    <Modal
      title="Run"
      subtitle={agent.name}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <span className="cg-empty-note">sample run — this touched no backend</span>
          <span className="cg-toolbar-spacer" />
          <button type="button" className="cg-btn" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <dl className="cg-run-stats">
        <div>
          <dt>Status</dt>
          <dd>{run.status}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{new Date(run.startedAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{run.durationMin}m</dd>
        </div>
        <div>
          <dt>Tokens</dt>
          <dd>{(run.tokens / 1000).toFixed(1)}k</dd>
        </div>
        <div>
          <dt>Capture</dt>
          <dd>hook</dd>
        </div>
      </dl>

      <ol className="cg-runlog" aria-label="Full run output">
        {steps.map((step, index) => (
          <li key={index} data-kind={step.kind}>
            <span className="cg-runlog-at">{step.at}</span>
            <span className="cg-runlog-kind">{step.kind}</span>
            <span className="cg-runlog-text">{step.text}</span>
          </li>
        ))}
      </ol>

      <section className="cg-section">
        <h3 className="cg-kicker">Artifacts</h3>
        <ul className="cg-artifacts">
          <li>
            <span className="cg-mono">{checkpoint}</span> checkpoint · {run.summary}
          </li>
          {run.branches.map((branch) => (
            <li key={branch}>
              <span className="cg-mono">branch</span> {branch}
            </li>
          ))}
          <li>
            <span className="cg-mono">packet</span> {(run.tokens / 1000).toFixed(1)}k tokens ready to
            inject into the next run
          </li>
        </ul>
      </section>
    </Modal>
  );
}
