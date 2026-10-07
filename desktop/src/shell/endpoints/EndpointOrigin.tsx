import type { Endpoint } from "@/lib/api";

function short(commit: string | null): string {
  return commit ? commit.slice(0, 7) : "—";
}

/**
 * Where an endpoint came from. When the change did not come from a recorded run
 * we say so instead of pretending to know more than git does.
 */
export default function EndpointOrigin({ endpoint }: { endpoint: Endpoint }) {
  const provenance = endpoint.provenance;
  if (!provenance || !provenance.code_commit) {
    return (
      <p className="cg-empty-note">
        No code location for this endpoint, so there is nothing to trace yet.
      </p>
    );
  }
  return (
    <>
      <dl className="cg-fields">
        {provenance.tracked ? (
          <>
            <div className="cg-field">
              <dt>Run</dt>
              <dd>{provenance.run_name ?? provenance.run_id}</dd>
            </div>
            <div className="cg-field">
              <dt>Agent</dt>
              <dd>{provenance.agent ?? "—"}</dd>
            </div>
            <div className="cg-field">
              <dt>Model</dt>
              <dd>{provenance.model ?? "—"}</dd>
            </div>
            <div className="cg-field">
              <dt>Conversation</dt>
              <dd className="cg-mono">{provenance.context_branch ?? "—"}</dd>
            </div>
          </>
        ) : (
          <div className="cg-field">
            <dt>Origin</dt>
            <dd>
              Not from a recorded run — this change came from outside
              ContextGit.
            </dd>
          </div>
        )}
        <div className="cg-field">
          <dt>Commit</dt>
          <dd>
            <span className="cg-mono">{short(provenance.code_commit)}</span>{" "}
            {provenance.code_commit_summary ?? ""}
          </dd>
        </div>
        <div className="cg-field">
          <dt>Author</dt>
          <dd>{provenance.author ?? "—"}</dd>
        </div>
        <div className="cg-field">
          <dt>When</dt>
          <dd>
            {provenance.committed_at
              ? new Date(provenance.committed_at).toLocaleString()
              : "—"}
          </dd>
        </div>
      </dl>
      {provenance.summary && (
        <p className="cg-view-sub">Why: {provenance.summary}</p>
      )}
      {provenance.excerpt && (
        <p className="cg-ep-excerpt">“{provenance.excerpt}”</p>
      )}
    </>
  );
}
