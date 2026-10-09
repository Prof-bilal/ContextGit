import type { AgentRun } from "@/lib/api";

export default function WorkRunCard({
  run,
  onApprove,
  onReject,
  onCommit,
  onIssue,
}: {
  run: AgentRun;
  onApprove: () => void;
  onReject: () => void;
  onCommit: () => void;
  onIssue: () => void;
}) {
  const plan = run.plan;
  const diff = run.artifacts.find((artifact) => artifact.kind === "diff");
  const check = run.artifacts.find((artifact) => artifact.kind === "check");
  return (
    <article className="cg-work-card" aria-label="Repository agent run">
      <header className="cg-work-card-head"><span className="cg-kicker">Work run</span><strong>{run.status.replaceAll("_", " ")}</strong></header>
      {plan && <div className="cg-work-plan"><h3>{plan.summary}</h3><ol>{(plan.steps ?? []).map((step) => <li key={step}>{step}</li>)}</ol>{(plan.files ?? []).length > 0 && <small>Files: {plan.files?.join(", ")}</small>}</div>}
      {run.error && <p className="cg-work-error">{run.error}</p>}
      {check && <pre className="cg-work-output">{check.content}</pre>}
      {diff && <details className="cg-work-diff"><summary>View diff</summary><pre>{diff.content || "No textual diff"}</pre></details>}
      <div className="cg-work-steps">{run.steps.map((step) => <span key={step.id} className={`cg-work-step cg-work-step-${step.status}`}>{step.kind} · {step.status}</span>)}</div>
      {run.status === "awaiting_approval" && <div className="cg-work-actions"><button type="button" className="cg-btn" onClick={onReject}>Reject plan</button><button type="button" className="cg-btn" data-variant="primary" onClick={onApprove}>Approve and implement</button></div>}
      {run.status === "ready" && <div className="cg-work-actions"><button type="button" className="cg-btn" onClick={onIssue}>Create local issue</button><button type="button" className="cg-btn" data-variant="primary" onClick={onCommit}>Approve commit</button></div>}
      {run.status === "completed" && <div className="cg-work-complete">Committed {run.resulting_commit?.slice(0, 7)}{run.issue ? ` · issue ${run.issue.id.slice(0, 7)}` : ""}</div>}
    </article>
  );
}
