import type { CommitKind } from "@/lib/api";

/** One real context change on the branch, shown as a governor receipt. */
export interface GovernorCommit {
  id: string;
  kind: CommitKind;
  summary: string | null;
  model: string;
  tokens: number;
}

/**
 * Context governor: how full the branch's context really is, and the commits
 * that got it there. The numbers come from the branch, not a fixture.
 */
export default function GovernorPanel({
  used,
  budget,
  messages,
  commits,
}: {
  used: number;
  budget: number;
  messages: number;
  commits: GovernorCommit[];
}) {
  const ratio = budget > 0 ? used / budget : 0;
  return (
    <section className="cg-governor" aria-label="Context governor">
      <header className="cg-block-head">
        <span className="cg-kicker">Context governor</span>
        <span className="cg-view-sub">
          {(used / 1000).toFixed(1)}k / {(budget / 1000).toFixed(0)}k · {messages} messages
        </span>
      </header>

      <div className="cg-burn">
        <div
          className="cg-burn-bar"
          data-tone={ratio > 0.85 ? "bad" : ratio > 0.6 ? "warn" : undefined}
        >
          <span style={{ width: `${Math.min(100, ratio * 100)}%` }} />
        </div>
      </div>

      <ul className="cg-receipts" aria-label="Recent context changes">
        {commits.map((commit) => (
          <li key={commit.id} className="cg-receipt" data-kind={commit.kind}>
            <span className="cg-receipt-kind">{commit.kind}</span>
            <span className="cg-receipt-copy">
              <strong>{commit.summary ?? "(no summary)"}</strong>
              <span>
                {commit.model} · {commit.tokens} tok · {commit.id.slice(0, 7)}
              </span>
            </span>
          </li>
        ))}
        {commits.length === 0 && <li className="cg-empty-note">No commits on this branch yet.</li>}
      </ul>

      <p className="cg-empty-note">
        Every context change is a commit; these numbers are the branch&apos;s real history.
      </p>
    </section>
  );
}
