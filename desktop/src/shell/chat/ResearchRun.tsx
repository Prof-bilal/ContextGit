import type { ResearchMode } from "../../mock/chat";
import { Chip } from "../primitives";
import ComparisonTable, { type ComparisonRowData } from "./ComparisonTable";
import LeadList, { type LeadSignalData } from "./LeadList";
import VerdictList, { type VerdictData } from "./VerdictList";

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

/** A structured result for the non-deep modes. */
export interface ResearchResultPayload {
  mode: string;
  rows?: ComparisonRowData[];
  how_we_differ?: string;
  name?: string;
  website?: string;
  description?: string;
  signals?: LeadSignalData[];
  verdicts?: VerdictData[];
}

const MODE_LABEL: Record<ResearchMode, string> = {
  deep: "Deep research",
  competitive: "Competitive research",
  lead: "Lead research",
  verify: "Verification pass",
};

/** A research run: a visible process, then a cited artifact. */
export default function ResearchRun({
  mode,
  steps,
  sources,
  report,
  result,
  error,
  done,
}: {
  mode: ResearchMode;
  steps: StepState[];
  sources: ResearchSource[];
  report: string;
  result: ResearchResultPayload | null;
  error: string | null;
  done: boolean;
}) {
  return (
    <section className="cg-block cg-research" aria-label={MODE_LABEL[mode]}>
      <header className="cg-block-head">
        <span className="cg-kicker">{MODE_LABEL[mode]}</span>
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

      {error && <p className="cg-pane-error">{error}</p>}

      {result?.mode === "competitive" && (
        <ComparisonTable rows={result.rows ?? []} howWeDiffer={result.how_we_differ} />
      )}
      {result?.mode === "lead" && (
        <LeadList
          name={result.name ?? ""}
          website={result.website}
          description={result.description}
          signals={result.signals ?? []}
        />
      )}
      {result?.mode === "verify" && <VerdictList verdicts={result.verdicts ?? []} />}

      {!result && report && <p className="cg-research-report">{report}</p>}
      {!result && !report && !error && !done && (
        <span className="cg-thinking">
          <span className="cg-thinking-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          researching…
        </span>
      )}
    </section>
  );
}
