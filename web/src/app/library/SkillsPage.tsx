/** Skills library: project and global skills from the API, built-in skills from roles.ts, drafts to review. */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { LuArrowUp, LuPlus, LuSearch, LuTrash2 } from "react-icons/lu";
import { projectApi, type LibrarySkill } from "@/shared/api";
import { SKILLS } from "@/shared/roles";
import { useApp } from "../context";
import { Button, Tabs } from "../ui";
import { Badge, LibraryContent, LibraryPage, NoProject, Section, errorText, formatDate } from "./shared";
import "./library.css";

type Scope = "project" | "global" | "built-in";

/** Built-in skills are fixed role briefs, shown read-only next to the reviewed ones. */
const BUILT_IN: LibrarySkill[] = Object.values(SKILLS).map(skill => ({
  id: `built-in:${skill.id}`,
  origin: "global",
  status: "approved",
  title: skill.label,
  instruction: skill.brief,
  evidence: "",
  scope: [],
  source_team: null,
  source_session: null,
  revision: 1,
  updated_at: "",
}));

const tone = (status: LibrarySkill["status"]) => status === "approved" ? "ok" : status === "draft" ? "warn" : "neutral";

export default function SkillsPage() {
  const { wb } = useApp();
  const projectPath = wb.activePath;
  const [skills, setSkills] = useState<LibrarySkill[]>([]);
  const [scope, setScope] = useState<Scope>("project");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [title, setTitle] = useState("");
  const [instruction, setInstruction] = useState("");
  const [evidence, setEvidence] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const api = useMemo(() => (projectPath ? projectApi(projectPath) : null), [projectPath]);

  const load = useCallback(async () => {
    if (!api || !projectPath) return;
    try {
      setSkills(await api.librarySkills(projectPath));
      setError("");
    } catch (cause) {
      setError(errorText(cause));
    }
  }, [api, projectPath]);

  useEffect(() => {
    if (!api) return;
    void load();
    // Teams propose drafts in the background; keep the list fresh.
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [api, load]);

  const list = useMemo(() => {
    const pool = scope === "built-in" ? BUILT_IN : skills.filter(skill => skill.origin === scope && skill.status !== "removed");
    const query = search.trim().toLowerCase();
    return query ? pool.filter(skill => `${skill.title}\n${skill.instruction}`.toLowerCase().includes(query)) : pool;
  }, [skills, scope, search]);

  // Look the selection up on every render, so polling never shows a stale copy.
  const selected = [...BUILT_IN, ...skills].find(skill => skill.id === selectedId) ?? null;
  const builtIn = selected?.id.startsWith("built-in:") ?? false;

  const select = (skill: LibrarySkill | null) => {
    setSelectedId(skill?.id ?? null);
    setReviewing(false);
    setError("");
  };

  const act = async (skill: LibrarySkill, action: "approve" | "reject" | "remove" | "promote") => {
    if (!api || !projectPath) return;
    setBusy(true);
    setError("");
    try {
      await api.reviewLibrarySkill(projectPath, skill, action, action === "approve" && reviewing ? instruction : undefined);
      setReviewing(false);
      if (action === "remove" || action === "reject") setSelectedId(null);
      await load();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const propose = async (event: FormEvent) => {
    event.preventDefault();
    if (!api || !projectPath) return;
    setBusy(true);
    setError("");
    try {
      await api.proposeLibrarySkill(projectPath, { title: title.trim(), instruction: instruction.trim(), evidence: evidence.trim(), scope: [] });
      setTitle("");
      setInstruction("");
      setEvidence("");
      setScope("project");
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
        <Section title="Skills library" description="Reusable instructions for agents. Teams propose drafts; nothing is used until you approve it.">
          {error && <p className="ui-error" role="alert">{error}</p>}
          <div className="lib-split">
            <aside className="lib-list-pane">
              <Tabs
                items={[
                  { id: "project", label: "Project" },
                  { id: "global", label: "Global" },
                  { id: "built-in", label: "Built-in" },
                ]}
                value={scope}
                onChange={value => { setScope(value); select(null); }}
                label="Skill scope"
              />
              <div className="lib-list-tools">
                <label className="lib-search">
                  <LuSearch className="lib-search-icon" aria-hidden="true" />
                  <input className="ui-input" aria-label="Search skills" placeholder="Search skills…"
                    value={search} onChange={event => setSearch(event.target.value)} />
                </label>
                <Button size="sm" icon={<LuPlus aria-hidden="true" />} onClick={() => select(null)}
                  aria-pressed={!selected}>New</Button>
              </div>
              <ul className="lib-list" aria-label="Skills">
                {list.map(skill => (
                  <li key={skill.id}>
                    <button type="button"
                      className={`lib-item lib-item-button${selected?.id === skill.id ? " lib-item--selected" : ""}${skill.status === "draft" ? " lib-item--pending" : ""}`}
                      aria-current={selected?.id === skill.id ? "true" : undefined}
                      onClick={() => select(skill)}>
                      <span className="lib-item-head">
                        <strong>{skill.title}</strong>
                        {scope !== "built-in" && <Badge tone={tone(skill.status)}>{skill.status}</Badge>}
                      </span>
                      <span className="lib-item-excerpt">{skill.instruction}</span>
                    </button>
                  </li>
                ))}
                {list.length === 0 && (
                  <li className="lib-item lib-item--empty">
                    <p className="lib-muted">{search ? "No skills match your search." : scope === "global" ? "No global skills yet. Promote an approved project skill." : "No skills yet."}</p>
                  </li>
                )}
              </ul>
            </aside>

            <div className="lib-detail">
              {selected ? (
                <>
                  <header className="lib-detail-head">
                    <h2>{selected.title}</h2>
                    <div className="lib-badges">
                      {builtIn ? <Badge tone="info">built-in</Badge> : <>
                        <Badge tone={tone(selected.status)}>{selected.status}</Badge>
                        <Badge tone="info">{selected.origin}</Badge>
                        <span className="lib-meta">rev {selected.revision} · {formatDate(selected.updated_at)}</span>
                      </>}
                    </div>
                  </header>
                  {reviewing ? (
                    <label className="lib-field">
                      <span className="ui-label">Reviewed instructions</span>
                      <textarea className="ui-textarea" rows={10} value={instruction} onChange={event => setInstruction(event.target.value)} />
                    </label>
                  ) : (
                    <pre className="lib-mono lib-instruction">{selected.instruction}</pre>
                  )}
                  {selected.evidence && (
                    <details className="lib-details">
                      <summary>Evidence</summary>
                      <p>{selected.evidence}</p>
                    </details>
                  )}
                  {!builtIn && (selected.source_team || selected.source_session) && (
                    <p className="lib-meta">From team {selected.source_team ?? "—"} · session {selected.source_session ?? "—"}</p>
                  )}
                  {!builtIn && (
                    <div className="lib-actions lib-actions--end">
                      {selected.status === "draft" && (reviewing ? (
                        <>
                          <Button variant="ghost" onClick={() => setReviewing(false)} disabled={busy}>Cancel</Button>
                          <Button variant="primary" onClick={() => void act(selected, "approve")} disabled={busy || !instruction.trim()}>Approve skill</Button>
                        </>
                      ) : (
                        <>
                          <Button variant="danger" onClick={() => void act(selected, "reject")} disabled={busy}>Reject</Button>
                          <Button onClick={() => { setReviewing(true); setInstruction(selected.instruction); }} disabled={busy}>Review and approve</Button>
                        </>
                      ))}
                      {selected.status === "approved" && selected.origin === "project" && (
                        <Button icon={<LuArrowUp aria-hidden="true" />} onClick={() => void act(selected, "promote")} disabled={busy}>Promote globally</Button>
                      )}
                      {selected.status !== "draft" && (
                        <Button variant="danger" icon={<LuTrash2 aria-hidden="true" />} onClick={() => void act(selected, "remove")} disabled={busy}>Remove</Button>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <form className="lib-form" onSubmit={event => void propose(event)}>
                  <h3>Add project skill</h3>
                  <p className="lib-muted">It is saved as a draft. Review and approve it before agents use it.</p>
                  <label className="lib-field">
                    <span className="ui-label">Skill title</span>
                    <input className="ui-input" value={title} maxLength={120} onChange={event => setTitle(event.target.value)} required />
                  </label>
                  <label className="lib-field">
                    <span className="ui-label">Instructions</span>
                    <textarea className="ui-textarea" rows={6} value={instruction} onChange={event => setInstruction(event.target.value)} required />
                  </label>
                  <label className="lib-field">
                    <span className="ui-label">Evidence / why this works</span>
                    <textarea className="ui-textarea" value={evidence} onChange={event => setEvidence(event.target.value)} />
                  </label>
                  <div className="lib-actions">
                    <Button type="submit" variant="primary" disabled={busy || !title.trim() || !instruction.trim()}>
                      {busy ? "Creating…" : "Create review draft"}
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
