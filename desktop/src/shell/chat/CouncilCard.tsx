import type { CouncilAnswer } from "../../mock/chat";
import { AgentMark, Chip } from "../primitives";
import { PROVIDERS } from "../providers";

/**
 * Council result: the same prompt answered by several models, side by side.
 * Keeping one records the decision (which model, and that there were others).
 */
export default function CouncilCard({
  providers,
  answers,
  kept,
  onKeep,
}: {
  providers: string[];
  answers: CouncilAnswer[];
  kept: string | null;
  onKeep: (providerId: string) => void;
}) {
  return (
    <section className="cg-block cg-council" aria-label="Model council">
      <header className="cg-block-head">
        <span className="cg-kicker">Model council</span>
        <span className="cg-view-sub">{providers.length} models · same prompt</span>
        {kept && (
          <Chip tone="ok">
            kept {PROVIDERS.find((provider) => provider.id === kept)?.label ?? kept}
          </Chip>
        )}
      </header>
      <div className="cg-council-grid" data-count={providers.length}>
        {providers.map((id) => {
          const provider = PROVIDERS.find((entry) => entry.id === id);
          const answer = answers.find((entry) => entry.providerId === id);
          return (
            <article key={id} className="cg-council-col" data-kept={kept === id}>
              <header className="cg-council-head">
                {provider && (
                  <AgentMark agent={provider.hue} icon={provider.id} label={provider.monogram} />
                )}
                <span className="cg-council-name">{provider?.label ?? id}</span>
                {answer?.stance === "dissents" && <Chip tone="warn">dissents</Chip>}
              </header>
              {answer ? (
                <p className="cg-council-text">{answer.text}</p>
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
                data-variant={kept === id ? undefined : "primary"}
                disabled={!answer || kept !== null}
                onClick={() => onKeep(id)}
              >
                {kept === id ? "Kept" : "Keep this"}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
