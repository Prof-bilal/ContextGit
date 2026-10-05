import type { ProviderInfo } from "@/lib/api";

import {
  ASPECTS,
  CHAT_MODES,
  COUNCIL_FACETS,
  RESEARCH_MODES,
  type ChatMode,
  type ComposerControls,
} from "../../mock/chat";
import { Chip } from "../primitives";

const DEPTHS: Array<ComposerControls["depth"]> = ["quick", "standard", "deep"];

/** One selectable council member (a provider + one of its models). */
export interface CouncilCandidate {
  key: string;
  providerId: string;
  modelId: string;
  label: string;
  /** Free to call: `:free` tier, or a local/offline provider. */
  free: boolean;
}

/** Three council slots, one dropdown each. */
const COUNCIL_SLOTS = [0, 1, 2] as const;

/** Unique, non-empty council keys in slot order (empty dropdowns dropped). */
export function councilMembers(council: string[]): string[] {
  const seen = new Set<string>();
  const members: string[] = [];
  for (const key of council) {
    if (key && !seen.has(key)) {
      seen.add(key);
      members.push(key);
    }
  }
  return members;
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
  /** Write one of the three council dropdowns, keeping the others in place. */
  const setCouncilSlot = (slot: number, key: string) => {
    const next = [controls.council[0] ?? "", controls.council[1] ?? "", controls.council[2] ?? ""];
    next[slot] = key;
    onControls({ council: next });
  };

  const chosen = councilMembers(controls.council);
  const selectedKeys = new Set(chosen);
  // The free/paid filter hides models, but never the ones already picked, so a
  // dropdown can't silently blank out a selection behind the user's back.
  const matchesFacet = (candidate: CouncilCandidate) =>
    controls.councilFacet === "all" ||
    selectedKeys.has(candidate.key) ||
    (controls.councilFacet === "free" ? candidate.free : !candidate.free);

  // Providers in registry order, each with its (filtered) models.
  const councilGroups: Array<{ providerId: string; label: string; options: CouncilCandidate[] }> = [];
  const groupIndex = new Map<string, number>();
  for (const candidate of councilCandidates) {
    if (!matchesFacet(candidate)) continue;
    let at = groupIndex.get(candidate.providerId);
    if (at === undefined) {
      at = councilGroups.length;
      groupIndex.set(candidate.providerId, at);
      councilGroups.push({ providerId: candidate.providerId, label: candidate.label, options: [] });
    }
    councilGroups[at].options.push(candidate);
  }

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
        <div className="cg-council-pick">
          <div className="cg-mini-seg" role="tablist" aria-label="Free or paid models">
            {COUNCIL_FACETS.map((facet) => (
              <button
                key={facet.value}
                type="button"
                role="tab"
                aria-selected={controls.councilFacet === facet.value}
                title={facet.hint}
                onClick={() => onControls({ councilFacet: facet.value })}
              >
                {facet.label}
              </button>
            ))}
          </div>
          <div className="cg-council-slots" role="group" aria-label="Council models">
            {COUNCIL_SLOTS.map((slot) => (
              <select
                key={slot}
                className="cg-mini-select"
                aria-label={`Council model ${slot + 1}`}
                value={controls.council[slot] ?? ""}
                disabled={councilCandidates.length === 0}
                onChange={(event) => setCouncilSlot(slot, event.target.value)}
              >
                <option value="">— pick a model —</option>
                {councilGroups.map((group) => (
                  <optgroup key={group.providerId} label={group.label}>
                    {group.options.map((candidate) => (
                      <option key={candidate.key} value={candidate.key}>
                        {candidate.modelId}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            ))}
          </div>
          {councilCandidates.length === 0 ? (
            <span className="cg-view-sub">Add a chat provider to run a council.</span>
          ) : (
            chosen.length < 2 && <Chip tone="warn">pick at least two</Chip>
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
