import {
  ASPECTS,
  CHAT_MODES,
  IMAGE_MODELS,
  type ChatMode,
  type ComposerControls,
} from "../../mock/chat";
import { Chip, Monogram } from "../primitives";
import { PROVIDERS } from "../providers";

const DEPTHS: Array<ComposerControls["depth"]> = ["quick", "standard", "deep"];

/**
 * Composer mode switch: one control decides what Send does, so the chat keeps a
 * single composer instead of a tab per feature.
 */
export default function ComposerModes({
  mode,
  onMode,
  controls,
  onControls,
}: {
  mode: ChatMode;
  onMode: (mode: ChatMode) => void;
  controls: ComposerControls;
  onControls: (patch: Partial<ComposerControls>) => void;
}) {
  const toggleProvider = (id: string) => {
    const selected = controls.council.includes(id);
    if (selected && controls.council.length <= 2) return; // council needs at least two
    if (!selected && controls.council.length >= 3) return; // and no more than three
    onControls({
      council: selected
        ? controls.council.filter((entry) => entry !== id)
        : [...controls.council, id],
    });
  };

  return (
    <div className="cg-modes">
      <div className="cg-mini-seg" role="tablist" aria-label="Composer mode">
        {CHAT_MODES.map((entry) => (
          <button
            key={entry.value}
            type="button"
            role="tab"
            aria-selected={mode === entry.value}
            title={entry.hint}
            onClick={() => onMode(entry.value)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <span className="cg-toolbar-spacer" />

      {mode === "council" && (
        <div className="cg-tags" role="group" aria-label="Council providers">
          {PROVIDERS.filter((provider) => provider.kind !== "compatible").map((provider) => {
            const on = controls.council.includes(provider.id);
            return (
              <button
                key={provider.id}
                type="button"
                className="cg-chip cg-chip-btn"
                aria-pressed={on}
                data-tone={on ? "signal" : undefined}
                title={`${provider.label} · ${provider.vendor}`}
                onClick={() => toggleProvider(provider.id)}
              >
                <Monogram agent={provider.hue} label={provider.monogram} />
                {provider.label}
              </button>
            );
          })}
        </div>
      )}

      {mode === "research" && (
        <div className="cg-mini-seg" role="tablist" aria-label="Research depth">
          {DEPTHS.map((depth) => (
            <button
              key={depth}
              type="button"
              role="tab"
              aria-selected={controls.depth === depth}
              onClick={() => onControls({ depth })}
            >
              {depth}
            </button>
          ))}
        </div>
      )}

      {mode === "image" && (
        <>
          <select
            className="cg-mini-select"
            aria-label="Image model"
            value={controls.imageModel}
            onChange={(event) => onControls({ imageModel: event.target.value })}
          >
            {IMAGE_MODELS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
          <select
            className="cg-mini-select"
            aria-label="Aspect ratio"
            value={controls.aspect}
            onChange={(event) => onControls({ aspect: event.target.value })}
          >
            {ASPECTS.map((aspect) => (
              <option key={aspect} value={aspect}>
                {aspect}
              </option>
            ))}
          </select>
          <Chip tone="warn">separate image endpoint</Chip>
        </>
      )}
    </div>
  );
}
