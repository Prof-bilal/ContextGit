/** Project memory: the approved revision, plus synthesizing, reviewing and approving a new one. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { LuCheck, LuX, LuTriangle, LuRefreshCw, LuFileText } from "react-icons/lu";
import { projectApi, type ProjectMemoryRevision, type MemoryConflict, type ProjectMemoryPreview } from "@/shared/api";
import { useApp } from "../context";
import { Button, EmptyState, PageHeader } from "../ui";
import { LibraryPage, LibraryContent, Section, Badge, NoProject, formatDate, errorText } from "./shared";
import "./library.css";

export default function MemoryPage() {
  const { wb } = useApp();
  const projectPath = wb.activePath;
  const [current, setCurrent] = useState<ProjectMemoryRevision | null>(null);
  // The unapproved revision the server just synthesized. Approval sends this
  // exact object back, so nothing the model wrote is lost.
  const [draft, setDraft] = useState<ProjectMemoryRevision | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);

  const api = useMemo(() => (projectPath ? projectApi(projectPath) : null), [projectPath]);

  const load = useCallback(async () => {
    if (!api || !projectPath) return;
    try {
      const result = await api.projectMemory(projectPath);
      setCurrent(result.current);
      setError("");
    } catch (cause) {
      setError(errorText(cause));
    }
  }, [api, projectPath]);

  useEffect(() => {
    setDraft(null);
    void load();
  }, [load]);

  const synthesize = async () => {
    if (!api || !projectPath) return;
    setSynthesizing(true);
    setError("");
    try {
      setDraft(await api.synthesizeProjectMemory({ projectPath }));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSynthesizing(false);
    }
  };

  const approve = async () => {
    if (!api || !draft) return;
    setBusy(true);
    setError("");
    try {
      setCurrent(await api.approveProjectMemory(draft.id, draft));
      setDraft(null);
      await load();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  // Rejecting only discards the local draft; it was never approved.
  const reject = () => setDraft(null);

  const preview: ProjectMemoryPreview | null = draft && {
    revision: draft.revision,
    summary: draft.summary,
    text: [
      ...draft.architecture, ...draft.workflow, ...draft.conventions, ...draft.decisions,
      ...draft.rejected, ...draft.skills, ...draft.validation, ...draft.open_questions,
    ].filter(Boolean).join("\n\n"),
  };
  const conflicts: MemoryConflict[] = draft?.conflicts ?? [];

  if (!projectPath) {
    return <NoProject title="Memory" what="Open a project to review and manage project memory." />;
  }

  return (
    <LibraryPage title="Memory">
      <LibraryContent>
        <Section title="Project memory" description="What agents should know about this project: architecture, conventions and decisions. Agents only see what you approve.">
          {error && <div className="ui-error" role="alert">{error}</div>}
          
          {current && (
            <div className="lib-item">
              <div className="lib-item-head">
                <div>
                  <strong>Current memory</strong> <span className="ui-sha">rev {current.revision}</span>
                  <div style={{ display: "flex", gap: "var(--app-s2)", alignItems: "center", flexWrap: "wrap" }}>
                    <Badge tone="ok">Approved</Badge>
                    <span className="lib-meta">{formatDate(current.approved_at)}</span>
                  </div>
                </div>
              </div>
              <details className="lib-details" open>
                <summary>Summary</summary>
                <p>{current.summary}</p>
              </details>
              {current.architecture.length > 0 && (
                <details className="lib-details">
                  <summary>Architecture</summary>
                  <ul style={{ margin: 0, paddingLeft: "var(--app-s4)", display: "grid", gap: "var(--app-s1)" }}>
                    {current.architecture.map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                </details>
              )}
              {current.workflow.length > 0 && (
                <details className="lib-details">
                  <summary>Workflow</summary>
                  <ul style={{ margin: 0, paddingLeft: "var(--app-s4)", display: "grid", gap: "var(--app-s1)" }}>
                    {current.workflow.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </details>
              )}
              {current.conventions.length > 0 && (
                <details className="lib-details">
                  <summary>Conventions</summary>
                  <ul style={{ margin: 0, paddingLeft: "var(--app-s4)", display: "grid", gap: "var(--app-s1)" }}>
                    {current.conventions.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </details>
              )}
              {current.decisions.length > 0 && (
                <details className="lib-details">
                  <summary>Decisions</summary>
                  <ul style={{ margin: 0, paddingLeft: "var(--app-s4)", display: "grid", gap: "var(--app-s1)" }}>
                    {current.decisions.map((d, i) => <li key={i}>{d}</li>)}
                  </ul>
                </details>
              )}
              {current.skills.length > 0 && (
                <details className="lib-details">
                  <summary>Skills</summary>
                  <ul style={{ margin: 0, paddingLeft: "var(--app-s4)", display: "grid", gap: "var(--app-s1)" }}>
                    {current.skills.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}
          {preview && (
            <div className="lib-item lib-item--pending" style={{ marginTop: "var(--app-s4)" }}>
              <div className="lib-item-head">
                <div>
                  <strong>Draft</strong> <span className="ui-sha">rev {preview.revision}</span>
                  <div style={{ display: "flex", gap: "var(--app-s2)", alignItems: "center", flexWrap: "wrap" }}>
                    <Badge tone="warn">Pending review</Badge>
                    <span className="lib-meta">Generated {formatDate(draft?.created_at ?? null)}</span>
                  </div>
                </div>
              </div>
              <details className="lib-details" open>
                <summary>Preview summary</summary>
                <p>{preview.summary}</p>
              </details>
              <details className="lib-details">
                <summary>Full text</summary>
                <pre className="lib-mono" style={{ maxHeight: "300px", overflow: "auto" }}>{preview.text}</pre>
              </details>
              {conflicts.length > 0 && (
                <details className="lib-details" open>
                  <summary>
                    <span style={{ display: "flex", alignItems: "center", gap: "var(--app-s2)" }}>
                      <LuTriangle style={{ color: "var(--app-warn)" }} />
                      Conflicts ({conflicts.length})
                    </span>
                  </summary>
                  <div className="lib-conflict-grid">
                    {conflicts.map((conflict, i) => (
                      <div key={i} className="lib-conflict-card">
                        <h4>{conflict.topic}</h4>
                        <div className="lib-conflict-row">
                          <div><strong>Existing:</strong> <span className="lib-mono">{conflict.existing}</span></div>
                          <div><strong>Proposed:</strong> <span className="lib-mono">{conflict.proposed}</span></div>
                        </div>
                        {conflict.source_session_ids.length > 0 && (
                          <p className="lib-muted">From sessions: {conflict.source_session_ids.join(", ")}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}
              <div className="lib-actions lib-actions--end">
                <Button variant="primary" onClick={() => void approve()} disabled={busy}>
                  <LuCheck /> Approve
                </Button>
                <Button variant="danger" onClick={reject} disabled={busy}>
                  <LuX /> Reject
                </Button>
              </div>
            </div>
          )}

          {!current && !preview && (
            <ol className="lib-empty-steps">
              <li>
                <strong>Draft</strong>
                <p>Summarise this project's finished sessions into a draft.</p>
              </li>
              <li>
                <strong>Review</strong>
                <p>Read the draft and any points that contradict the current memory.</p>
              </li>
              <li>
                <strong>Approve</strong>
                <p>Approved memory is what agents read. Rejecting discards the draft.</p>
              </li>
            </ol>
          )}

          <div className="lib-actions" style={{ marginTop: "var(--app-s4)", paddingTop: "var(--app-s4)", borderTop: "1px solid var(--app-line)" }}>
            <Button variant="primary" onClick={() => void synthesize()} disabled={busy || synthesizing || !!draft}>
              {synthesizing ? <><LuRefreshCw className="lib-spin" aria-hidden="true" /> Drafting…</> : <>Draft from sessions</>}
            </Button>
            <Button variant="ghost" onClick={() => void load()} disabled={busy}>
              <LuRefreshCw /> Refresh
            </Button>
          </div>
        </Section>
      </LibraryContent>
    </LibraryPage>
  );
}
