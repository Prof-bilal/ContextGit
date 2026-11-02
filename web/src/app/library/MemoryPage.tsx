/** OWNER: library agent. Full-height Memory page. */
import { useEffect, useMemo, useState } from "react";
import { LuCheck, LuX, LuTriangle, LuRefreshCw, LuFileText, LuSparkles } from "react-icons/lu";
import { projectApi, type ProjectMemoryRevision, type MemoryConflict, type ProjectMemoryPreview } from "@/shared/api";
import { useApp } from "../context";
import { Button, EmptyState, PageHeader } from "../ui";
import { LibraryPage, LibraryContent, Section, Badge, NoProject, formatDate, errorText } from "./shared";
import "./library.css";

export default function MemoryPage() {
  const { wb, go } = useApp();
  const projectPath = wb.activePath;
  const [current, setCurrent] = useState<ProjectMemoryRevision | null>(null);
  const [preview, setPreview] = useState<ProjectMemoryPreview | null>(null);
  const [conflicts, setConflicts] = useState<MemoryConflict[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);

  const api = useMemo(() => (projectPath ? projectApi(projectPath) : null), [projectPath]);

  const load = async () => {
    if (!api || !projectPath) return;
    try {
      const result = await api.projectMemory(projectPath);
      setCurrent(result.current);
      setPreview(result.text ? { revision: result.current?.revision ?? 0, summary: "Preview available", text: result.text } : null);
      if (result.current?.conflicts) {
        setConflicts(result.current.conflicts);
      }
      setError("");
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  useEffect(() => {
    if (api && projectPath) {
      void load();
    }
  }, [api, projectPath]);

  const synthesize = async () => {
    if (!api || !projectPath) return;
    setSynthesizing(true);
    setError("");
    try {
      const result = await api.synthesizeProjectMemory({ projectPath });
      const text = [
        result.summary,
        ...result.architecture,
        ...result.workflow,
        ...result.conventions,
        ...result.decisions,
        ...result.rejected,
        ...result.skills,
        ...result.validation,
        ...result.open_questions,
      ].filter(Boolean).join("\n\n");
      setPreview({ revision: result.revision, summary: result.summary, text });
      setConflicts(result.conflicts || []);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSynthesizing(false);
    }
  };

  const approve = async () => {
    if (!api || !preview) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.approveProjectMemory(preview.revision.toString(), {
        ...preview,
        id: preview.revision.toString(),
        project_path: projectPath,
        revision: preview.revision,
        status: "approved",
        summary: preview.summary,
        architecture: [],
        workflow: [],
        conventions: [],
        decisions: [],
        rejected: [],
        skills: [],
        validation: [],
        open_questions: [],
        conflicts: conflicts,
        source_session_ids: [],
        source_commit_ids: [],
        provider: null,
        model: null,
        created_at: new Date().toISOString(),
        approved_at: new Date().toISOString(),
      } as ProjectMemoryRevision);
      setCurrent(result);
      setPreview(null);
      setConflicts([]);
      await load();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    setPreview(null);
    setConflicts([]);
  };

  if (!projectPath) {
    return <NoProject title="Memory" what="Open a project to review and manage project memory." />;
  }

  return (
    <LibraryPage title="Memory">
      <LibraryContent>
        <Section title="Project memory" description="Reviewed knowledge extracted from completed sessions. Completed teams propose reusable memory and skills.">
          {error && <div className="ui-error" role="alert">{error}</div>}
          
          {current && (
            <div className="lib-item">
              <div className="lib-item-head">
                <div>
                  <strong>Approved memory (rev {current.revision})</strong>
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
            <div className="lib-item lib-item--pending" style={{ borderColor: "rgb(255 106 61 / 0.5)", marginTop: "var(--app-s4)" }}>
              <div className="lib-item-head">
                <div>
                  <strong>Pending preview (rev {preview.revision})</strong>
                  <div style={{ display: "flex", gap: "var(--app-s2)", alignItems: "center", flexWrap: "wrap" }}>
                    <Badge tone="warn">Pending review</Badge>
                    <span className="lib-meta">Generated {new Date().toLocaleString()}</span>
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
                <Button variant="primary" onClick={approve} disabled={busy}>
                  <LuCheck /> Approve
                </Button>
                <Button variant="danger" onClick={reject} disabled={busy}>
                  <LuX /> Reject
                </Button>
              </div>
            </div>
          )}

          {!current && !preview && (
            <div className="lib-empty-steps">
              <li>
                <strong>Synthesize memory</strong>
                <p>Click "Generate preview" to create a new memory preview from completed sessions.</p>
              </li>
              <li>
                <strong>Review preview</strong>
                <p>Review the generated summary, full text, and any conflicts with existing memory.</p>
              </li>
              <li>
                <strong>Approve or reject</strong>
                <p>Approve to save as the new project memory, or reject to discard.</p>
              </li>
            </div>
          )}

          <div className="lib-actions" style={{ marginTop: "var(--app-s4)", paddingTop: "var(--app-s4)", borderTop: "1px solid var(--app-line)" }}>
            <Button variant="primary" onClick={synthesize} disabled={busy || synthesizing || !!preview}>
              {synthesizing ? <><LuRefreshCw className="lib-spin" /> Generating...</> : <><LuSparkles /> Generate preview</>}
            </Button>
            <Button variant="ghost" onClick={load} disabled={busy}>
              <LuRefreshCw /> Refresh
            </Button>
          </div>
        </Section>
      </LibraryContent>
    </LibraryPage>
  );
}
