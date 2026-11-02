import { useEffect, useState } from "react";
import { projectApi } from "@/shared/api";
import { SKILLS } from "@/shared/roles";

export interface RunSkill { id: string; title: string; instruction: string; origin: string }

export function RunSkills({ project, selected, onChange, disabled, onLoading }: {
  project: string; selected: RunSkill[]; onChange: (skills: RunSkill[]) => void;
  disabled: boolean; onLoading: (loading: boolean) => void;
}) {
  const [library, setLibrary] = useState<RunSkill[]>([]);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    onChange([]);
    setLibrary([]);
    setError("");
    if (!project) { onLoading(false); return; }
    onLoading(true);
    void projectApi(project).librarySkills(project).then(skills => {
      if (active) setLibrary(skills.filter(skill => skill.status === "approved").map(skill => ({
        id: `${skill.origin}:${skill.id}`, title: skill.title,
        instruction: skill.instruction, origin: skill.origin,
      })));
    }).catch(cause => { if (active) setError(String(cause)); })
      .finally(() => { if (active) onLoading(false); });
    return () => { active = false; };
  }, [project, onChange, onLoading]);
  const skills = [...Object.values(SKILLS).map(skill => ({
    id: `built-in:${skill.id}`, title: skill.label, instruction: skill.brief, origin: "built-in",
  })), ...library].filter(skill => (filter === "all" || filter === skill.origin)
    && `${skill.title} ${skill.instruction}`.toLowerCase().includes(query.toLowerCase()));
  return <fieldset className="sp-run-skills" disabled={disabled}>
    <legend>Skills · {selected.length} selected</legend>
    <p>Choose skills for this run. Manage custom skills in the Skills library.</p>
    <div className="sp-run-skills-tools">
      <select aria-label="Skill source" value={filter} onChange={event => setFilter(event.target.value)}>
        <option value="all">All skills</option><option value="built-in">Built-in</option>
        <option value="project">Project</option><option value="global">Global</option>
      </select>
      <input aria-label="Search skills" placeholder="Search skills…" value={query} onChange={event => setQuery(event.target.value)} />
    </div>
    {error && <p role="alert">Could not load custom skills: {error}</p>}
    <div className="sp-run-skills-list">
      {skills.map(skill => <label key={skill.id}>
        <input type="checkbox" checked={selected.some(item => item.id === skill.id)}
          onChange={event => onChange(event.target.checked ? [...selected, skill] : selected.filter(item => item.id !== skill.id))} />
        <span><strong>{skill.title}</strong><small>{skill.origin} · {skill.instruction}</small></span>
      </label>)}
      {!skills.length && <p>No matching skills.</p>}
    </div>
  </fieldset>;
}

export function AgentSkills({ skills }: { skills: string[] }) {
  if (!skills.length) return null;
  return <aside className="sp-agent-skills nodrag" aria-label="Agent skills"
    onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
    <strong>Skills used by this agent</strong>
    <ul>{skills.map((skill, index) => <li key={`${index}:${skill}`}>{skill}</li>)}</ul>
  </aside>;
}
