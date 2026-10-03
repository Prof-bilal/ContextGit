import type { AgentRun } from "../../mock/fixtures";
import { runSteps } from "./runOutput";

/** Expanded output for one run: stats, the step log, and what it produced. */
export default function RunOutput({
  run,
  onViewDiff,
  onOpenRun,
}: {
  run: AgentRun;
  onViewDiff: () => void;
  onOpenRun: () => void;
}) {
  const steps = runSteps(run);

  return (
    <div className="cg-run-detail">
      <dl className="cg-run-stats">
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
          <dt>Branches</dt>
          <dd>{run.branches.join(", ") || "—"}</dd>
        </div>
      </dl>

      <ol className="cg-runlog" aria-label="Run output">
        {steps.map((step, index) => (
          <li key={index} data-kind={step.kind}>
            <span className="cg-runlog-at">{step.at}</span>
            <span className="cg-runlog-kind">{step.kind}</span>
            <span className="cg-runlog-text">{step.text}</span>
          </li>
        ))}
      </ol>

      <div className="cg-run-actions">
        <button type="button" className="cg-btn cg-btn-sm" onClick={onViewDiff}>
          View diff
        </button>
        <button type="button" className="cg-btn cg-btn-sm" onClick={onOpenRun}>
          Open run
        </button>
        <span className="cg-empty-note">sample output — this run touched no backend</span>
      </div>
    </div>
  );
}
