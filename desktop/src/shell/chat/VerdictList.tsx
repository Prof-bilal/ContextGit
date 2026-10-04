import { Chip } from "../primitives";

export interface VerdictData {
  claim: string;
  verdict: "supported" | "contradicted" | "unverifiable";
  evidence?: string;
  source_id?: number | null;
}

const TONE = {
  supported: "ok",
  contradicted: "bad",
  unverifiable: "warn",
} as const;

/** Verification output: one verdict per claim, with the evidence that decided it. */
export default function VerdictList({ verdicts }: { verdicts: VerdictData[] }) {
  if (verdicts.length === 0) {
    return <p className="cg-empty-note">No claims could be checked.</p>;
  }
  return (
    <ul className="cg-verdicts">
      {verdicts.map((verdict, index) => (
        <li key={`${verdict.claim}-${index}`} className="cg-verdict" data-verdict={verdict.verdict}>
          <Chip tone={TONE[verdict.verdict]}>{verdict.verdict}</Chip>
          <span className="cg-verdict-copy">
            <strong>{verdict.claim}</strong>
            {verdict.evidence && <span>{verdict.evidence}</span>}
          </span>
          {verdict.source_id != null && (
            <span className="cg-mono">[{verdict.source_id}]</span>
          )}
        </li>
      ))}
    </ul>
  );
}
