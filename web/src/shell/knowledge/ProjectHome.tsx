import { useCallback, useEffect, useRef, useState } from "react";
import { projectApi, type Session } from "@/shared/api";
import type { Knowledge } from "../../../shared/knowledge";
import LessonReview from "./LessonReview";
import ProviderSettings from "./ProviderSettings";
import { useWorkbench } from "../WorkbenchContext";

export default function ProjectHome({ onNew }: { onNew: () => void }) {
  const { workspace, sessions, openSession, setCheckpointSession, revision } = useWorkbench();
  const [data, setData] = useState<Knowledge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const [connectionNotice, setConnectionNotice] = useState("");
  const path = workspace?.path;
  const requestRevision = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const ticket = ++requestRevision.current;
    try {
      const next = await projectApi(path).knowledge(path);
      if (ticket === requestRevision.current) { setData(next); setError(null); }
    } catch (cause) { if (ticket === requestRevision.current) setError(cause instanceof Error ? cause.message : "Could not read project knowledge"); }
  }, [path]);
  useEffect(() => { setData(null); setError(null); void load(); return () => { requestRevision.current++; }; }, [load, revision]);
  const recent = sessions.filter(s => s.project_path === path && s.agent !== "shell")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const resume = (session: Session) => openSession(session);
  return <section className="cg-project-home" aria-label="Project home">
    <div className="cg-home-heading"><div><span className="cg-kicker">Your project</span><h2>{workspace?.name ?? "Open a project to begin"}</h2><p>Pick up where you left off. Keep the lessons that worked.</p></div>
      <button className="cg-btn" data-variant="primary" onClick={onNew} disabled={!path}>Start new task</button></div>
    {recent[0] && <div className="cg-knowledge-card cg-resume-card"><div><span className="cg-kicker">Continue working</span><h3>{recent[0].name}</h3><p>{recent[0].category || "Recent conversation"}</p></div><button className="cg-btn" onClick={() => resume(recent[0])}>Resume conversation</button></div>}
    <div className="cg-home-heading"><h3>Recent conversations</h3><input type="search" aria-label="Search conversations" placeholder="Find a task or category" value={filter} onChange={e => setFilter(e.target.value)} /></div>
    {recent.length === 0 && <p className="cg-empty-note">Your conversations and checkpoints will appear here.</p>}
    {recent.filter(s => `${s.name} ${s.category ?? ""}`.toLowerCase().includes(filter.toLowerCase())).slice(0, 20).map(session => {
      const checkpoint = data?.checkpoints.find(c => c.session_id === session.id);
      return <article className="cg-knowledge-card cg-conversation-row" key={session.id}><div><strong>{session.name}</strong><p>{session.category || "Uncategorized"} · {session.status}{checkpoint?.feedback.rating ? ` · ${checkpoint.feedback.rating}/5` : ""}</p>{checkpoint?.warning && <small>{checkpoint.warning}</small>}</div>
        <div className="cg-knowledge-actions"><button className="cg-btn" onClick={() => setCheckpointSession({ session, closing: false })}>Review checkpoint</button><button className="cg-btn" onClick={() => resume(session)}>Resume</button></div></article>;
    })}
    <div className="cg-home-heading"><h3>Project knowledge</h3><div className="cg-knowledge-actions"><button className="cg-btn" disabled={!path} onClick={() => setSetupOpen(v => !v)}>AI connection</button><button className="cg-btn" onClick={() => void load()}>Refresh</button></div></div>
    {setupOpen && path && <ProviderSettings key={path} projectPath={path} onClose={() => setSetupOpen(false)} onSaved={() => { setSetupOpen(false); setConnectionNotice("AI connection saved for this project."); }} />}
    {connectionNotice && <p role="status">{connectionNotice}</p>}
    {error && <p className="cg-banner" role="alert">{error}</p>}
    <p className="cg-empty-note">Review generated guidance before future agents use it. Ratings alone do not activate instructions.</p>
    {data?.lessons.length === 0 && <p className="cg-empty-note">No learning drafts yet. Review a conversation to generate one.</p>}
    {data?.lessons.filter(l => l.status !== "rejected").map(lesson => <LessonReview key={lesson.id + lesson.status} lesson={lesson} onChanged={() => void load()} />)}
  </section>;
}
