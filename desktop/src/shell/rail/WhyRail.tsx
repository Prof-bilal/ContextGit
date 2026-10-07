import type { WhyFinding } from "@/lib/api";

import type { WhyState } from "../why/useWhy";

/** The timeline of changes to a file — click one to read why it happened. */
export default function WhyRail({ state }: { state: WhyState }) {
  const { history, answer, path, select } = state;
  const active = answer?.findings[0]?.code_commit ?? null;

  return (
    <nav className="cg-rail" aria-label="Changes to this file">
      <div className="cg-rail-head">
        <h2>History</h2>
        <span className="cg-count">{history.length}</span>
      </div>
      {!path.trim() && <p className="cg-empty-note">Type a file path to see its history.</p>}
      {path.trim() && history.length === 0 && (
        <p className="cg-empty-note">No recorded changes for this file yet.</p>
      )}
      {history.map((finding, index) => (
        <button
          key={`${finding.code_commit ?? index}`}
          type="button"
          className="cg-row"
          aria-current={active === finding.code_commit}
          onClick={() => select(finding)}
        >
          <span className="cg-row-top">
            <span className="cg-mono cg-ep-dot-none">
              {finding.code_commit ? finding.code_commit.slice(0, 7) : "—"}
            </span>
            {finding.tracked ? (
              <span className="cg-ep-badge cg-api-ok">run</span>
            ) : (
              <span className="cg-ep-badge">commit</span>
            )}
          </span>
          <span className="cg-row-name">{finding.summary ?? "(no message)"}</span>
          <span className="cg-row-preview">
            {finding.run_name ?? finding.author ?? ""}
            {finding.committed_at
              ? ` · ${new Date(finding.committed_at).toLocaleDateString()}`
              : ""}
          </span>
        </button>
      ))}
    </nav>
  );
}

export type { WhyFinding };
