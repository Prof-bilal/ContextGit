import { useState } from "react";
import { LuX } from "react-icons/lu";
import type { TeamPlanTask, SpatialTeam } from "@/shared/api";
export type TeamPreset = {
  id: string;
  name: string;
  orchestrator: string;
  goal: string;
  tasks: TeamPlanTask[];
};
const KEY = "contextgit:team-presets:v1";
function read(): TeamPreset[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
export default function PresetsPanel({
  team,
  close,
  load,
}: {
  team: SpatialTeam | null;
  close: () => void;
  load: (preset: TeamPreset) => void;
}) {
  const [presets, setPresets] = useState(read);
  const [name, setName] = useState("My team preset");
  const update = (next: TeamPreset[]) => {
    localStorage.setItem(KEY, JSON.stringify(next));
    setPresets(next);
  };
  return (
    <aside
      className="sp-float sp-presets"
      role="dialog"
      aria-labelledby="team-presets-title"
    >
      <header>
        <div>
          <small>Reusable team plans</small>
          <h2 id="team-presets-title">Team presets</h2>
        </div>
        <button onClick={close} aria-label="Close presets">
          <LuX />
        </button>
      </header>
      <p className="sp-presets-intro">
        Load a reusable team plan, edit its goal and review before launching.
      </p>
      {presets.length > 0 ? (
        <div className="sp-presets-list">
          {presets.map((preset) => (
            <article className="sp-preset-card" key={preset.id}>
              <div>
                <strong>{preset.name}</strong>
                <small>
                  {preset.tasks.length} workers · {preset.orchestrator}
                </small>
              </div>
              <div className="sp-preset-actions">
                <button onClick={() => load(preset)}>Load draft</button>
                <button
                  className="sp-danger-button"
                  onClick={() =>
                    update(presets.filter((item) => item.id !== preset.id))
                  }
                >
                  Remove
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="sp-presets-empty">
          <span aria-hidden="true">✦</span>
          <strong>No saved presets yet</strong>
          <small>Save this team plan below to reuse it in a future run.</small>
        </div>
      )}
      <div className="sp-preset-save">
        <label htmlFor="team-preset-name">Save the current plan</label>
        <div>
          <input
            id="team-preset-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Full-stack review"
          />
          <button
            className="sp-primary"
            disabled={!team?.plan || !name.trim()}
            onClick={() => {
              if (!team?.plan) return;
              update([
                ...presets,
                {
                  id: crypto.randomUUID(),
                  name: name.trim(),
                  orchestrator: team.team.orchestrator_agent ?? "claude",
                  goal: team.team.goal,
                  tasks: team.plan.plan.tasks ?? [],
                },
              ]);
            }}
          >
            Save preset
          </button>
        </div>
        {!team?.plan && <small>Approve a team plan before saving it.</small>}
      </div>
    </aside>
  );
}
