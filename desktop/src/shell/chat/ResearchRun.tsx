import { Chip } from "../primitives";

export interface StepState {
  id: string;
  label: string;
  detail: string;
  status: "pending" | "active" | "done";
}

export interface ResearchSource {
  id: number;
  title: string;
  host: string;
}

/** Deep research: the run is a visible process, then a cited report. */
export default function ResearchRun({
  steps,
  sources,
  report,
  done,
}: {
  steps: StepState[];
  sources: ResearchSource[];
  report: string;
  done: boolean;
}) {
  return (
    <section className="cg-block cg-research" aria-label="Deep research run">
      <header className="cg-block-head">
        <span className="cg-kicker">Deep research</span>
        <span className="cg-view-sub">{done ? "complete" : "running…"}</span>
        {done && <Chip tone="ok">{sources.length} sources cited</Chip>}
      </header>

      <ol className="cg-steps">
        {steps.map((step) => (
          <li key={step.id} data-status={step.status}>
            <span className="cg-step-dot" aria-hidden="true" />
            <span className="cg-step-label">{step.label}</span>
            <span className="cg-step-detail">{step.detail}</span>
          </li>
        ))}
      </ol>

      {sources.length > 0 && (
        <div className="cg-tags" aria-label="Sources">
          {sources.map((source) => (
            <span key={source.id} className="cg-chip" title={source.title}>
              <span className="cg-mono">[{source.id}]</span> {source.host}
            </span>
          ))}
        </div>
      )}

      {done && <p className="cg-research-report">{report}</p>}
    </section>
  );
}
