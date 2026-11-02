/** OWNER: library agent. Full-height Skills page. */
import { useEffect, useMemo, useState } from "react";
import { LuSearch, LuX, LuPlus, LuCheck, LuArchive, LuTrash2, LuArrowUp } from "react-icons/lu";
import { projectApi, type LibrarySkill } from "@/shared/api";
import { useApp } from "../context";
import { Button, EmptyState, PageHeader, Tabs } from "../ui";
import { LibraryPage, LibraryContent, Section, Badge, NoProject, formatDate, errorText } from "./shared";
import "./library.css";

export default function SkillsPage() {
  const { wb, go } = useApp();
  const projectPath = wb.activePath;
  const [skills, setSkills] = useState<LibrarySkill[]>([]);
  const [origin, setOrigin] = useState<"project" | "global" | "built-in">("project");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<LibrarySkill | null>(null);
  const [editing, setEditing] = useState<LibrarySkill | null>(null);
  const [title, setTitle] = useState("");
  const [instruction, setInstruction] = useState("");
  const [evidence, setEvidence] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const api = useMemo(() => (projectPath ? projectApi(projectPath) : null), [projectPath]);

  const load = async () => {
    if (!api || !projectPath) return;
    try {
      setSkills(await api.librarySkills(projectPath));
      setError("");
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  useEffect(() => {
    if (api && projectPath) {
      void load();
      const timer = setInterval(() => void load(), 5000);
      return () => clearInterval(timer);
    }
  }, [api, projectPath]);

  const filteredSkills = useMemo(() => {
    const list = skills.filter((s) => s.origin === origin || (origin === "built-in" && s.origin === "global"));
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((s) => s.title.toLowerCase().includes(q) || s.instruction.toLowerCase().includes(q));
  }, [skills, origin, search]);

  const act = async (skill: LibrarySkill, action: "approve" | "reject" | "remove" | "promote") => {
    if (!api || !projectPath) return;
    setBusy(true);
    try {
      await api.reviewLibrarySkill(projectPath, skill, action, editing?.id === skill.id ? instruction : undefined);
      setEditing(null);
      setInstruction("");
      await load();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const propose = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!api || !projectPath) return;
    setBusy(true);
    try {
      await api.proposeLibrarySkill(projectPath, { title, instruction, evidence, scope: [] });
      setTitle("");
      setInstruction("");
      setEvidence("");
      await load();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!projectPath) {
    return <NoProject title="Skills" what="Open a project to manage reusable skills." />;
  }

  return (
    <LibraryPage title="Skills">
      <LibraryContent>
        <Section title="Skills library" description="Reviewed reusable instructions. Filter by scope and search by keyword.">
          <div className="lib-split">
            <aside className="lib-list-pane">
              <Tabs
                items={[
                  { id: "project", label: "Project" },
                  { id: "global", label: "Global" },
                  { id: "built-in", label: "Built-in" },
                ]}
                value={origin}
                onChange={setOrigin}
                label="Skill scope"
              />
              <label className="lib-field" style={{ marginTop: "var(--app-s3)" }}>
                <span className="ui-label">Search</span>
                <div style={{ display: "flex", gap: "var(--app-s2)" }}>
                  <LuSearch className="lib-search-icon" />
                  <input
                    className="ui-input"
                    placeholder="Search skills..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </label>
              <ul className="lib-list" role="listbox" aria-label="Skills">
                {filteredSkills.map((skill) => (
                  <li
                    key={skill.id}
                    className={`lib-item ${selected?.id === skill.id ? "lib-item--selected" : ""} ${skill.status === "draft" ? "lib-item--pending" : ""}`}
                    role="option"
                    aria-selected={selected?.id === skill.id}
                    onClick={() => setSelected(skill)}
                  >
                    <div className="lib-item-head">
                      <div>
                        <strong>{skill.title}</strong>
                        <div style={{ display: "flex", gap: "var(--app-s2)", alignItems: "center", flexWrap: "wrap" }}>
                          <Badge tone={skill.status === "approved" ? "ok" : skill.status === "draft" ? "warn" : "neutral"}>{skill.status}</Badge>
                          <Badge tone="info">{skill.origin}</Badge>
                          <span className="lib-meta">{formatDate(skill.updated_at)}</span>
                        </div>
                      </div>
                    </div>
                    <p>{skill.instruction.slice(0, 160)}{skill.instruction.length > 160 ? "..." : ""}</p>
                  </li>
                ))}
                {filteredSkills.length === 0 && (
                  <li className="lib-item lib-item--empty">
                    <p className="lib-muted">No skills found.</p>
                  </li>
                )}
              </ul>
            </aside>
            <div className="lib-detail">
              {selected ? (
                <>
                  <header className="lib-detail-head">
                    <h2>{selected.title}</h2>
                    <div style={{ display: "flex", gap: "var(--app-s2)", alignItems: "center", flexWrap: "wrap" }}>
                      <Badge tone={selected.status === "approved" ? "ok" : selected.status === "draft" ? "warn" : "neutral"}>{selected.status}</Badge>
                      <Badge tone="info">{selected.origin}</Badge>
                      <span className="lib-meta">rev {selected.revision} · {formatDate(selected.updated_at)}</span>
                    </div>
                  </header>
                  <details className="lib-details">
                    <summary>Instructions</summary>
                    <pre className="lib-mono">{selected.instruction}</pre>
                  </details>
                  {selected.evidence && (
                    <details className="lib-details">
                      <summary>Evidence</summary>
                      <pre className="lib-mono">{selected.evidence}</pre>
                    </details>
                  )}
                  {selected.scope.length > 0 && (
                    <details className="lib-details">
                      <summary>Scope</summary>
                      <ul style={{ margin: 0, paddingLeft: "var(--app-s4)", display: "grid", gap: "var(--app-s1)" }}>
                        {selected.scope.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <div className="lib-actions lib-actions--end">
                    {selected.status === "draft" && (
                      <>
                        {editing?.id === selected.id ? (
                          <>
                            <label className="lib-field" style={{ width: "100%", marginTop: "var(--app-s3)" }}>
                              <span className="ui-label">Reviewed instructions</span>
                              <textarea
                                className="ui-textarea"
                                value={instruction}
                                onChange={(e) => setInstruction(e.target.value)}
                                defaultValue={selected.instruction}
                              />
                            </label>
                            <Button variant="primary" onClick={() => void act(selected, "approve")} disabled={busy}>
                              Approve skill
                            </Button>
                          </>
                        ) : (
                          <Button onClick={() => { setEditing(selected); setInstruction(selected.instruction); }}>Review</Button>
                        )}
                        <Button variant="danger" onClick={() => void act(selected, "reject")} disabled={busy}>
                          Reject
                        </Button>
                        <Button variant="danger" onClick={() => void act(selected, "remove")} disabled={busy}>
                          <LuTrash2 /> Remove
                        </Button>
                        {selected.origin === "project" && (
                          <Button onClick={() => void act(selected, "promote")} disabled={busy}>
                            <LuArrowUp /> Promote globally
                          </Button>
                        )}
                      </>
                    )}
                    {selected.status === "approved" && (
                      <Button variant="ghost" disabled={true}><LuArchive /> Approved — attach from session</Button>
                    )}
                  </div>
                </>
              ) : (
                <form className="lib-form" onSubmit={propose}>
                  <h3>Add project skill</h3>
                  <label className="lib-field">
                    <span className="ui-label">Skill title</span>
                    <input
                      className="ui-input"
                      placeholder="Skill title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      required
                    />
                  </label>
                  <label className="lib-field">
                    <span className="ui-label">Instructions</span>
                    <textarea
                      className="ui-textarea"
                      placeholder="Instructions"
                      value={instruction}
                      onChange={(e) => setInstruction(e.target.value)}
                      required
                    />
                  </label>
                  <label className="lib-field">
                    <span className="ui-label">Evidence / why this works</span>
                    <textarea
                      className="ui-textarea"
                      placeholder="Evidence / why this works"
                      value={evidence}
                      onChange={(e) => setEvidence(e.target.value)}
                    />
                  </label>
                  <div className="lib-actions">
                    <Button type="submit" variant="primary" disabled={busy}>
                      {busy ? "Creating..." : "Create review draft"}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </Section>
      </LibraryContent>
    </LibraryPage>
  );
}