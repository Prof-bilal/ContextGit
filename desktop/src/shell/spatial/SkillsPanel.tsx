import { useEffect, useMemo, useState } from "react";
import { LuX } from "react-icons/lu";
import { projectApi, type LibrarySkill, type SpatialTeam } from "@/shared/api";
import { SKILLS } from "@/shared/roles";

export default function SkillsPanel({
  project,
  team,
  close,
  refresh,
}: {
  project: string;
  team: SpatialTeam | null;
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const api = useMemo(() => projectApi(project), [project]);
  const [skills, setSkills] = useState<LibrarySkill[]>([]);
  const [origin, setOrigin] = useState("project");
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [instruction, setInstruction] = useState("");
  const [evidence, setEvidence] = useState("");
  const [editing, setEditing] = useState<LibrarySkill | null>(null);
  const [target, setTarget] = useState("team");
  useEffect(() => {
    setTarget("team");
  }, [team?.team.id]);
  const load = async () => {
    try {
      setSkills(await api.librarySkills(project));
    } catch (cause) {
      setError(String(cause));
    }
  };
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [api]);
  const act = async (
    skill: LibrarySkill,
    action: "approve" | "reject" | "remove" | "promote",
  ) => {
    try {
      await api.reviewLibrarySkill(
        project,
        skill,
        action,
        editing?.id === skill.id ? instruction : undefined,
      );
      setEditing(null);
      await load();
    } catch (cause) {
      setError(String(cause));
    }
  };
  const attach = async (
    id: string,
    label: string,
    text: string,
    source: "built-in" | "project" | "global",
  ) => {
    if (!team) return;
    const task = team.tasks.find((item) => item.id === target);
    try {
      await api.attachTeamSkill(team.team.id, {
        skill_id: id,
        title: label,
        instruction: text,
        origin: source,
        ...(task ? { task_id: task.id, agent: task.agent ?? undefined } : {}),
      });
      await refresh();
    } catch (cause) {
      setError(String(cause));
    }
  };
  return (
    <aside className="sp-float sp-skills">
      <header>
        <div>
          <small>Reviewed reusable instructions</small>
          <h2>Skills library</h2>
        </div>
        <button onClick={close} aria-label="Close skills">
          <LuX />
        </button>
      </header>
      <div className="sp-skill-tabs">
        {["project", "global", "built-in"].map((value) => (
          <button
            key={value}
            aria-pressed={value === origin}
            onClick={() => setOrigin(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <label>
        Assign to
        <select
          aria-label="Skill assignment target"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        >
          <option value="team">Entire team</option>
          {team?.tasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.title} · {task.agent}
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      {!!team?.skills.length && (
        <div className="sp-attached">
          {team.skills.map((link) => (
            <button
              key={link.id}
              onClick={() =>
                void api
                  .detachTeamSkill(team.team.id, link.id)
                  .then(refresh)
                  .catch((cause) => setError(String(cause)))
              }
            >
              {link.title} ×
            </button>
          ))}
        </div>
      )}
      {origin === "built-in"
        ? Object.values(SKILLS).map((skill) => (
            <button
              className="sp-skill"
              key={skill.id}
              disabled={!team}
              onClick={() =>
                void attach(skill.id, skill.label, skill.brief, "built-in")
              }
            >
              <span>
                <strong>{skill.label}</strong>
                <small>{skill.brief}</small>
              </span>
              +
            </button>
          ))
        : skills
            .filter((skill) => skill.origin === origin)
            .map((skill) => (
              <article className="sp-library-skill" key={skill.id}>
                <strong>{skill.title}</strong>
                <small>
                  {skill.status} · revision {skill.revision}
                </small>
                <p>{skill.instruction}</p>
                <details>
                  <summary>Evidence and origin</summary>
                  <p>{skill.evidence || "Added by user"}</p>
                  <small>
                    Team: {skill.source_team ?? "user"} · Session:{" "}
                    {skill.source_session ?? "—"}
                  </small>
                </details>
                <div className="sp-skill-tabs">
                  {skill.status === "approved" ? (
                    <>
                      <button
                        disabled={!team}
                        onClick={() =>
                          void attach(
                            skill.id,
                            skill.title,
                            skill.instruction,
                            skill.origin,
                          )
                        }
                      >
                        Attach snapshot
                      </button>
                      {skill.origin === "project" && (
                        <button onClick={() => void act(skill, "promote")}>
                          Promote globally
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setEditing(skill);
                          setInstruction(skill.instruction);
                        }}
                      >
                        Review
                      </button>
                      <button onClick={() => void act(skill, "reject")}>
                        Reject
                      </button>
                    </>
                  )}
                  <button onClick={() => void act(skill, "remove")}>
                    Remove
                  </button>
                </div>
                {editing?.id === skill.id && (
                  <div>
                    <label>
                      Reviewed instructions
                      <textarea
                        value={instruction}
                        onChange={(event) => setInstruction(event.target.value)}
                      />
                    </label>
                    <button
                      className="sp-primary"
                      onClick={() => void act(skill, "approve")}
                    >
                      Approve skill
                    </button>
                  </div>
                )}
              </article>
            ))}
      <form
        className="sp-skill-form"
        onSubmit={(event) => {
          event.preventDefault();
          void api
            .proposeLibrarySkill(project, {
              title,
              instruction,
              evidence,
              scope: [],
            })
            .then(async () => {
              setTitle("");
              setInstruction("");
              setEvidence("");
              await load();
            })
            .catch((cause) => setError(String(cause)));
        }}
      >
        <h3>Add project skill</h3>
        <input
          aria-label="Skill title"
          placeholder="Skill title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
        />
        <textarea
          aria-label="Skill instructions"
          placeholder="Instructions"
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          required
        />
        <textarea
          aria-label="Skill evidence"
          placeholder="Evidence / why this works"
          value={evidence}
          onChange={(event) => setEvidence(event.target.value)}
        />
        <button className="sp-primary" type="submit">
          Create review draft
        </button>
      </form>
    </aside>
  );
}
