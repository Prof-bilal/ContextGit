import { useEffect, useState } from "react";

import { api, type Commit, type Diff } from "@/lib/api";
import Modal from "../Modal";
import { Chip } from "../primitives";

/**
 * The 3-level diff's message level: what a commit added over its parent, and the
 * token cost. This is the product's differentiator — previously invisible.
 */
export default function DiffSheet({
  commit,
  parentId,
  onClose,
}: {
  commit: Commit;
  parentId: string | null;
  onClose: () => void;
}) {
  const [diff, setDiff] = useState<Diff | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!parentId) {
      setDiff(null);
      return;
    }
    let alive = true;
    void api
      .diff(parentId, commit.id)
      .then((result) => {
        if (alive) setDiff(result);
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : "Could not load the diff");
      });
    return () => {
      alive = false;
    };
  }, [commit.id, parentId]);

  const tokenDelta = diff ? diff.b_token_count - diff.a_token_count : 0;

  return (
    <Modal
      title="Diff"
      subtitle={`${commit.id.slice(0, 7)} · ${commit.summary ?? commit.kind}`}
      size="lg"
      onClose={onClose}
      footer={
        <button type="button" className="cg-btn" onClick={onClose}>
          Close
        </button>
      }
    >
      {!parentId && (
        <p className="cg-empty-note">This is the root commit — there is nothing before it to diff.</p>
      )}
      {error && <p className="cg-pane-error">{error}</p>}

      {diff && (
        <>
          <div className="cg-tags">
            <Chip>{diff.a_id.slice(0, 7)} → {diff.b_id.slice(0, 7)}</Chip>
            <Chip>ancestor {diff.ancestor_id.slice(0, 7)}</Chip>
            <Chip tone={tokenDelta > 0 ? "warn" : "ok"}>
              tokens {tokenDelta >= 0 ? "+" : ""}
              {tokenDelta.toLocaleString()}
            </Chip>
          </div>

          <section className="cg-section">
            <h3 className="cg-kicker">Added in this commit</h3>
            {diff.b_messages.length > diff.a_messages.length ? (
              <ul className="cg-diff">
                {diff.b_messages.slice(diff.a_messages.length).map((message, index) => (
                  <li key={index} data-change="added">
                    <span className="cg-diff-sign" aria-hidden="true">
                      +
                    </span>
                    <span className="cg-diff-kind">{message.role}</span>
                    <span className="cg-diff-text">{message.content}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="cg-empty-note">No new messages — the context is unchanged.</p>
            )}
          </section>

          <dl className="cg-run-stats">
            <div>
              <dt>Before</dt>
              <dd>
                {diff.a_messages.length} messages · {diff.a_token_count.toLocaleString()} tokens
              </dd>
            </div>
            <div>
              <dt>After</dt>
              <dd>
                {diff.b_messages.length} messages · {diff.b_token_count.toLocaleString()} tokens
              </dd>
            </div>
          </dl>
        </>
      )}

      {!diff && !error && parentId && <p className="cg-empty-note">Loading diff…</p>}
    </Modal>
  );
}
