import { useState } from "react";
import {
  LuCircle,
  LuCircleCheck,
  LuCircleHelp,
  LuCircleX,
  LuDiamond,
  LuTriangleAlert,
} from "react-icons/lu";

import { api, type Branch, type MergePreview } from "@/lib/api";
import Modal from "../Modal";
import { Chip } from "../primitives";

/**
 * PR-style merge: preview what the source branch learned, resolve any conflicts
 * by hand, then apply a two-parent summary commit. Nothing is auto-resolved.
 */
export default function MergeDialog({
  branches,
  target,
  onApplied,
  onClose,
}: {
  branches: Branch[];
  target: string;
  onApplied: (commitId: string) => void;
  onClose: () => void;
}) {
  const sources = branches.filter((branch) => branch.name !== target);
  const [source, setSource] = useState(sources[0]?.name ?? "");
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const makePreview = async () => {
    if (!source) return;
    setBusy(true);
    try {
      const proposal = await api.mergePreview(source, target);
      setPreview(proposal);
      setSummary(proposal.summary);
      setResolutions({});
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the preview");
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const applied = await api.mergeApply(preview, resolutions, summary);
      onApplied(applied.commit.id);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not apply the merge");
    } finally {
      setBusy(false);
    }
  };

  const unresolved = preview?.conflicts.some((conflict) => !resolutions[conflict.id]) ?? false;

  return (
    <Modal
      title="Merge"
      subtitle={`into ${target}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="cg-btn" onClick={onClose}>
            Cancel
          </button>
          {preview ? (
            <button
              type="button"
              className="cg-btn"
              data-variant="primary"
              disabled={busy || !summary.trim() || unresolved}
              onClick={() => void apply()}
            >
              {busy ? "Applying…" : "Apply merge commit"}
            </button>
          ) : (
            <button
              type="button"
              className="cg-btn"
              data-variant="primary"
              disabled={busy || !source}
              onClick={() => void makePreview()}
            >
              {busy ? "Reviewing…" : "Review merge"}
            </button>
          )}
        </>
      }
    >
      {sources.length === 0 ? (
        <p className="cg-empty-note">
          Only <strong>{target}</strong> exists so far — make another branch to merge something in.
        </p>
      ) : (
        <>
          <div className="cg-field-block">
            <label className="cg-kicker" htmlFor="cg-merge-source">
              Merge from
            </label>
            <select
              id="cg-merge-source"
              className="cg-mini-select"
              value={source}
              onChange={(event) => {
                setSource(event.target.value);
                setPreview(null);
              }}
            >
              {sources.map((branch) => (
                <option key={branch.name} value={branch.name}>
                  {branch.name} · {branch.head_commit_id.slice(0, 7)}
                </option>
              ))}
            </select>
          </div>

          <p className="cg-empty-note">
            Apply creates a two-parent commit; neither side's history is deleted.
          </p>

          {error && <p className="cg-pane-error">{error}</p>}

          {preview && (
            <>
              <div className="cg-tags">
                <Chip tone="ok">
                  <LuDiamond aria-hidden="true" /> {preview.extraction.decisions.length} decisions
                </Chip>
                <Chip>
                  <LuCircle aria-hidden="true" /> {preview.extraction.facts.length} facts
                </Chip>
                <Chip tone="warn">
                  <LuCircleX aria-hidden="true" /> {preview.extraction.dead_ends.length} dead ends
                </Chip>
                <Chip>
                  <LuCircleHelp aria-hidden="true" /> {preview.extraction.open_questions.length} open
                  questions
                </Chip>
                {preview.conflicts.length > 0 ? (
                  <Chip tone="bad">
                    <LuTriangleAlert aria-hidden="true" /> {preview.conflicts.length} conflict
                    {preview.conflicts.length === 1 ? "" : "s"} to resolve
                  </Chip>
                ) : (
                  <Chip tone="ok">
                    <LuCircleCheck aria-hidden="true" /> no conflicts
                  </Chip>
                )}
              </div>

              <p className="cg-empty-note">
                Common ancestor {preview.ancestor_id.slice(0, 7)} · {preview.summary_confidence}{" "}
                confidence
              </p>

              {preview.fallback && (
                <p className="cg-empty-note">
                  Semantic extraction unavailable — this preview preserves source messages verbatim.
                </p>
              )}

              <div className="cg-cards">
                {(["decisions", "facts", "dead_ends", "open_questions"] as const).map((key) => (
                  <div key={key} className="cg-card">
                    <h3>
                      {key.replace("_", " ")} <span className="cg-chip">{preview.extraction[key].length}</span>
                    </h3>
                    {preview.extraction[key].length > 0 ? (
                      <ul>
                        {preview.extraction[key].map((item, index) => (
                          <li key={index}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="cg-card-empty">Nothing extracted.</p>
                    )}
                  </div>
                ))}
              </div>

              {preview.conflicts.map((conflict) => (
                <fieldset className="cg-conflict" key={conflict.id}>
                  <legend>
                    {conflict.topic} <small>({conflict.category})</small>
                  </legend>
                  <label>
                    <input
                      type="radio"
                      name={`conflict-${conflict.id}`}
                      checked={resolutions[conflict.id] === "target"}
                      onChange={() =>
                        setResolutions((current) => ({ ...current, [conflict.id]: "target" }))
                      }
                    />
                    Keep target: {conflict.target}
                  </label>
                  <label>
                    <input
                      type="radio"
                      name={`conflict-${conflict.id}`}
                      checked={resolutions[conflict.id] === "source"}
                      onChange={() =>
                        setResolutions((current) => ({ ...current, [conflict.id]: "source" }))
                      }
                    />
                    Keep source: {conflict.source}
                  </label>
                  <label>
                    Or write the resolution
                    <input
                      className="cg-text-input"
                      value={
                        resolutions[conflict.id] && !["source", "target"].includes(resolutions[conflict.id])
                          ? resolutions[conflict.id]
                          : ""
                      }
                      onChange={(event) =>
                        setResolutions((current) => ({
                          ...current,
                          [conflict.id]: event.target.value,
                        }))
                      }
                      placeholder="One line that resolves it"
                    />
                  </label>
                </fieldset>
              ))}

              <label className="cg-kicker" htmlFor="cg-merge-summary">
                Proposed summary
              </label>
              <textarea
                id="cg-merge-summary"
                className="cg-textarea"
                rows={4}
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
              />
            </>
          )}
        </>
      )}
    </Modal>
  );
}
