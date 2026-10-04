import type { ProviderInfo } from "@/lib/api";

import {
  ASPECTS,
  CHAT_MODES,
  RESEARCH_MODES,
  type ChatMode,
  type ComposerControls,
} from "../../mock/chat";
import { AgentMark, Chip } from "../primitives";
import { brandFor } from "../providers";

const DEPTHS: Array<ComposerControls["depth"]> = ["quick", "standard", "deep"];

/** One selectable council member (a provider + one of its models). */
export interface CouncilCandidate {
  key: string;
  providerId: string;
  modelId: string;
  label: string;
}

/**
 * Composer mode switch: one control decides what Send does, so the chat keeps a
 * single composer instead of a tab per feature. Council and image options come
 * from the live provider registry.
 */
export default function ComposerModes({
  mode,
  onMode,
  controls,
  onControls,
  councilCandidates,
  imageProviders,
}: {
  mode: ChatMode;
  onMode: (mode: ChatMode) => void;
  controls: ComposerControls;
  onControls: (patch: Partial<ComposerControls>) => void;
  councilCandidates: CouncilCandidate[];
  imageProviders: ProviderInfo[];
}) {
  const toggleMember = (key: string) => {
    const selected = controls.council.includes(key);
    if (selected && controls.council.length <= 2) return; // council needs at least two
    if (!selected && controls.council.length >= 5) return; // and no more than five
    onControls({
      council: selected
        ? controls.council.filter((entry) => entry !== key)
        : [...controls.council, key],
    });
  };

  const activeImageProvider =
    imageProviders.find((provider) => provider.id === controls.imageProvider) ??
    imageProviders[0];
  const imageModels = activeImageProvider?.models ?? [];

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
        <div className="cg-tags" role="group" aria-label="Council members">
          {councilCandidates.map((candidate) => {
            const on = controls.council.includes(candidate.key);
            const brand = brandFor(candidate.providerId, candidate.label);
            return (
              <button
                key={candidate.key}
                type="button"
                className="cg-chip cg-chip-btn"
                aria-pressed={on}
                data-tone={on ? "signal" : undefined}
                title={`${candidate.label} · ${candidate.modelId}`}
                onClick={() => toggleMember(candidate.key)}
              >
                <AgentMark agent={brand.hue} icon={brand.icon} label={brand.monogram} />
                {candidate.label}
                <span className="cg-mono"> {candidate.modelId}</span>
              </button>
            );
          })}
          {councilCandidates.length === 0 && (
            <span className="cg-view-sub">Add a chat provider to run a council.</span>
          )}
          {councilCandidates.length > 0 && controls.council.length < 2 && (
            <Chip tone="warn">pick at least two</Chip>
          )}
        </div>
      )}

      {mode === "research" && (
        <>
          <div className="cg-mini-seg" role="tablist" aria-label="Research type">
            {RESEARCH_MODES.map((entry) => (
              <button
                key={entry.value}
                type="button"
                role="tab"
                aria-selected={controls.researchMode === entry.value}
                title={entry.hint}
                onClick={() => onControls({ researchMode: entry.value })}
              >
                {entry.label}
              </button>
            ))}
          </div>
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
        </>
      )}

      {mode === "image" && (
        <>
          <select
            className="cg-mini-select"
            aria-label="Image provider"
            value={activeImageProvider?.id ?? ""}
            onChange={(event) => {
              const provider = imageProviders.find((entry) => entry.id === event.target.value);
              onControls({
                imageProvider: event.target.value,
                imageModel: provider?.models[0] ?? provider?.default_model ?? "",
              });
            }}
          >
            {imageProviders.length === 0 && <option value="">No image provider</option>}
            {imageProviders.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
          <select
            className="cg-mini-select"
            aria-label="Image model"
            value={controls.imageModel}
            onChange={(event) => onControls({ imageModel: event.target.value })}
          >
            {imageModels.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
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
        </>
      )}
    </div>
  );
}
