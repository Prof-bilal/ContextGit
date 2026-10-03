import { useEffect, useRef, useState } from "react";
import { LuX } from "react-icons/lu";

import ClayAvatar from "../avatar/ClayAvatar";
import {
  AGENT_HUES,
  SCHEDULES,
  SKILL_CATALOG,
  newSeed,
  type MissionDraft,
} from "./mission";

/**
 * One dialog for both jobs: creating an agent and editing its mission. Same
 * mechanics as the other dialogs (focus trap, Esc, backdrop), plus the avatar
 * picker — the creature is derived from a seed, so shuffle just re-rolls it.
 */
export default function AgentDialog({
  mode,
  initial,
  onSave,
  onClose,
}: {
  mode: "create" | "edit";
  initial: MissionDraft;
  onSave: (draft: MissionDraft) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<MissionDraft>(initial);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    if (mode === "create") nameRef.current?.focus();
    else {
      textRef.current?.focus();
      textRef.current?.setSelectionRange(initial.mission.length, initial.mission.length);
    }
    return () => restoreRef.current?.focus?.();
  }, [mode, initial.mission.length]);

  const patch = (next: Partial<MissionDraft>) => setDraft((current) => ({ ...current, ...next }));

  const toggleSkill = (skill: string) =>
    patch({
      skills: draft.skills.includes(skill)
        ? draft.skills.filter((entry) => entry !== skill)
        : [...draft.skills, skill],
    });

  const canSave = draft.name.trim().length > 0 && draft.mission.trim().length > 0;

  return (
    <div className="cg-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="cg-modal cg-mission"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cg-agent-dialog-title"
        ref={dialogRef}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
          if (event.key === "Tab") {
            const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            );
            if (!focusables || focusables.length === 0) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <header className="cg-picker-head">
          <h2 id="cg-agent-dialog-title">{mode === "create" ? "New agent" : "Edit agent"}</h2>
          <span className="cg-view-sub">
            {mode === "create" ? "gives you a creature of its own" : draft.name}
          </span>
          <span className="cg-toolbar-spacer" />
          <button type="button" className="cg-icon-btn" aria-label="Close" onClick={onClose}>
            <LuX aria-hidden="true" />
          </button>
        </header>

        <div className="cg-mission-body">
          <div className="cg-agent-top">
            <ClayAvatar
              seed={draft.seed}
              hue={draft.hue}
              state={draft.enabled ? "idle" : "paused"}
              size="lg"
              label="Avatar preview"
            />
            <div className="cg-agent-avatar-controls">
              <span className="cg-kicker">Avatar</span>
              <div className="cg-hue-row" role="group" aria-label="Avatar colour">
                {AGENT_HUES.map((hue) => (
                  <button
                    key={hue}
                    type="button"
                    className="cg-hue"
                    data-agent={hue}
                    aria-pressed={draft.hue === hue}
                    aria-label={`Colour ${hue}`}
                    title={hue}
                    onClick={() => patch({ hue })}
                  />
                ))}
              </div>
              <button
                type="button"
                className="cg-btn cg-btn-sm"
                onClick={() => patch({ seed: newSeed(draft.name) })}
              >
                Shuffle avatar
              </button>
              <p className="cg-empty-note">
                Shuffle rerolls the shape, topping, eyes and blush. Same agent keeps the same blob.
              </p>
            </div>
          </div>

          <label className="cg-kicker" htmlFor="cg-agent-name">
            Name
          </label>
          <input
            id="cg-agent-name"
            className="cg-text-input"
            ref={nameRef}
            value={draft.name}
            onChange={(event) => patch({ name: event.target.value })}
            placeholder="e.g. Changelog Writer"
          />

          <label className="cg-kicker" htmlFor="cg-mission-text">
            What is its purpose?
          </label>
          <textarea
            id="cg-mission-text"
            className="cg-textarea"
            rows={4}
            ref={textRef}
            value={draft.mission}
            onChange={(event) => patch({ mission: event.target.value })}
            placeholder="e.g. Every Friday, read the commits merged to main and draft release notes. Group by area, keep it under 300 words."
          />
          <p className="cg-empty-note">
            Prepended to every run, together with the agent's memory from the DAG.
          </p>

          <span className="cg-kicker">Skills</span>
          <div className="cg-tags">
            {SKILL_CATALOG.map((skill) => {
              const on = draft.skills.includes(skill);
              return (
                <button
                  key={skill}
                  type="button"
                  className="cg-chip cg-chip-btn"
                  aria-pressed={on}
                  data-tone={on ? "signal" : undefined}
                  onClick={() => toggleSkill(skill)}
                >
                  {skill}
                </button>
              );
            })}
          </div>

          <div className="cg-mission-row">
            <div className="cg-field-block">
              <label className="cg-kicker" htmlFor="cg-agent-schedule">
                Schedule
              </label>
              <select
                id="cg-agent-schedule"
                className="cg-mini-select"
                value={draft.cron}
                onChange={(event) => patch({ cron: event.target.value })}
              >
                {SCHEDULES.map((entry) => (
                  <option key={entry.cron} value={entry.cron}>
                    {entry.human} · {entry.cron}
                  </option>
                ))}
              </select>
            </div>
            <label className="cg-toggle">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => patch({ enabled: event.target.checked })}
              />
              Enabled
            </label>
          </div>
        </div>

        <footer className="cg-mission-foot">
          <span className="cg-empty-note">
            {draft.skills.length} skill{draft.skills.length === 1 ? "" : "s"} · {draft.cron}
          </span>
          <span className="cg-toolbar-spacer" />
          <button type="button" className="cg-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="cg-btn"
            data-variant="primary"
            disabled={!canSave}
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            {mode === "create" ? "Create agent" : "Save changes"}
          </button>
        </footer>
      </div>
    </div>
  );
}
