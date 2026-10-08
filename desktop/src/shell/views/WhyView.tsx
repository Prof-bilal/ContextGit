import { Chip } from "../primitives";
import type { WhyFinding } from "@/lib/api";
import type { WhyState } from "../why/useWhy";

function Group({ title, items, tone }: { title: string; items: string[]; tone?: "ok" | "warn" }) {
  if (items.length === 0) return null;
  return (
    <>
      <h2 className="cg-ep-h2">{title}</h2>
      <ul className="cg-why-list">
        {items.map((item, index) => (
          <li key={index} className={tone === "warn" ? "cg-api-warn" : undefined}>
            {item}
          </li>
        ))}
      </ul>
    </>
  );
}

/** The reasoning behind one change: why it exists, and what was rejected. */
export function WhyFindingDetail({ finding }: { finding: WhyFinding }) {
  return (
    <>
      <p className="cg-view-sub">
        {finding.summary ?? "(no commit message)"}
        {finding.committed_at ? ` · ${new Date(finding.committed_at).toLocaleString()}` : ""}
      </p>
      <Group title="Decisions" items={finding.decisions} />
      <Group title="Rejected (dead ends)" items={finding.dead_ends} tone="warn" />
      <Group title="Open questions" items={finding.open_questions} />
      <Group title="Facts" items={finding.facts} />
      {finding.excerpt && <p className="cg-ep-excerpt">“{finding.excerpt}”</p>}
    </>
  );
}

/** The "Why" lens: what this file is, as of any point in its history. */
export default function WhyView({ state }: { state: WhyState }) {
  const { path, setPath, line, setLine, asOf, answer, loading, error, hasProvider, explain } =
    state;
  const primary = answer?.findings[0];
  const earlier = (answer?.findings ?? []).slice(1);

  return (
    <div className="cg-view" data-active="true">
      <div className="cg-view-toolbar">
        <h1>Why</h1>
        <span className="cg-view-sub">
          {hasProvider
            ? "The reasoning behind the code, from the runs that wrote it"
            : "Connect a chat provider to read the reasoning"}
        </span>
      </div>
      <div className="cg-view-body">
        <div className="cg-why-bar">
          <label className="cg-why-field cg-why-field-path">
            <span className="cg-field-label">File</span>
            <input
              className="cg-input cg-mono cg-why-path"
              aria-label="File path"
              placeholder="src/routes/auth.js"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void explain();
              }}
            />
          </label>
          <label className="cg-why-field cg-why-field-line">
            <span className="cg-field-label">Line</span>
            <input
              className="cg-input cg-mono cg-why-line"
              aria-label="Line"
              placeholder="line"
              value={line}
              onChange={(event) => setLine(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void explain();
              }}
            />
          </label>
          <button
            type="button"
            className="cg-btn cg-why-explain"
            data-variant="primary"
            disabled={loading || !path.trim()}
            onClick={() => void explain()}
          >
            {loading ? "Reading…" : "Explain"}
          </button>
          {asOf && <Chip tone="warn">as of {asOf.slice(0, 7)}</Chip>}
          {answer?.cached && <Chip>cached</Chip>}
        </div>
        {error && <p className="cg-api-error">{error}</p>}

        {!answer ? (
          <div className="cg-why-empty">
            <h2 className="cg-why-empty-title">Trace why a line exists</h2>
            <p className="cg-empty-note">
              Point at a file — or an endpoint in the Endpoints tab — and
              ContextGit reads the decisions, the rejected alternatives and the
              open questions from the run that produced it.
            </p>
          </div>
        ) : (
          <section className="cg-ep">
            {answer.note && <p className="cg-ep-notice">{answer.note}</p>}
            {primary && <WhyFindingDetail finding={primary} />}
            {earlier.length > 0 && (
              <>
                <h2 className="cg-ep-h2">Earlier changes</h2>
                {earlier.map((finding, index) => (
                  <p className="cg-view-sub" key={index}>
                    <span className="cg-mono">
                      {finding.code_commit ? finding.code_commit.slice(0, 7) : "—"}
                    </span>{" "}
                    {finding.summary ?? "(no message)"}
                  </p>
                ))}
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
