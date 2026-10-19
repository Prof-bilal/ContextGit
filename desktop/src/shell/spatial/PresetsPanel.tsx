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
    <aside className="sp-float">
      <header>
        <h2>Team presets</h2>
        <button onClick={close} aria-label="Close presets">
          <LuX />
        </button>
      </header>
      <p>
        Load a reusable team plan, edit its goal and review before launching.
      </p>
      {presets.map((preset) => (
        <article className="sp-library-skill" key={preset.id}>
          <strong>{preset.name}</strong>
          <p>
            {preset.tasks.length} workers · {preset.orchestrator}
          </p>
          <button onClick={() => load(preset)}>Load draft</button>
          <button
            onClick={() =>
              update(presets.filter((item) => item.id !== preset.id))
            }
          >
            Remove preset
          </button>
        </article>
      ))}
      <label>
        Preset name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <button
        className="sp-primary"
        disabled={!team?.plan || !name.trim()}
        onClick={() => {
          if (!team?.plan) return;
          update([
            ...presets,
            {
              id: crypto.randomUUID(),
              name,
              orchestrator: team.team.orchestrator_agent ?? "claude",
              goal: team.team.goal,
              tasks: team.plan.plan.tasks ?? [],
            },
          ]);
        }}
      >
        Save selected team
      </button>
    </aside>
  );
}
