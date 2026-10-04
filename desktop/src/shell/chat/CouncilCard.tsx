import { AgentMark, Chip } from "../primitives";
import { brandFor } from "../providers";

/** One council column: which provider/model answered, and its display brand. */
export interface CouncilMemberView {
  key: string;
  providerId: string;
  modelId: string;
  label: string;
}

/**
 * Council result: the same prompt answered by several models, side by side.
 * Keeping one records the decision (which model, and that there were others).
 */
export default function CouncilCard({
  members,
  answers,
  errors,
  kept,
  onKeep,
}: {
  members: CouncilMemberView[];
  /** One entry per member, filled as tokens arrive. */
  answers: string[];
  /** One entry per member; a non-null value means that member failed. */
  errors: Array<string | null>;
  kept: number | null;
  onKeep: (index: number) => void;
}) {
  return (
    <section className="cg-block cg-council" aria-label="Model council">
      <header className="cg-block-head">
        <span className="cg-kicker">Model council</span>
        <span className="cg-view-sub">{members.length} models · same prompt</span>
        {kept !== null && (
          <Chip tone="ok">kept {members[kept]?.label ?? members[kept]?.modelId ?? "one"}</Chip>
        )}
      </header>
      <div className="cg-council-grid" data-count={members.length}>
        {members.map((member, index) => {
          const brand = brandFor(member.providerId, member.label);
          const answer = answers[index];
          const error = errors[index];
          return (
            <article key={member.key} className="cg-council-col" data-kept={kept === index}>
              <header className="cg-council-head">
                <AgentMark agent={brand.hue} icon={brand.icon} label={brand.monogram} />
                <span className="cg-council-name">
                  {member.label}
                  <span className="cg-view-sub"> · {member.modelId}</span>
                </span>
              </header>
              {error ? (
                <p className="cg-pane-error">⚠ {error}</p>
              ) : answer ? (
                <p className="cg-council-text">{answer}</p>
              ) : (
                <span className="cg-thinking">
                  <span className="cg-thinking-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  asking…
                </span>
              )}
              <button
                type="button"
                className="cg-btn cg-btn-sm"
                data-variant={kept === index ? undefined : "primary"}
                disabled={!answer || error !== null || kept !== null}
                onClick={() => onKeep(index)}
              >
                {kept === index ? "Kept" : "Keep this"}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
