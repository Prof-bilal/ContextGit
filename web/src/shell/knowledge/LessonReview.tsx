import { useState } from "react";
import { projectApi } from "@/shared/api";
import type { Lesson } from "../../../shared/knowledge";

export default function LessonReview({ lesson, onChanged }: { lesson: Lesson; onChanged: () => void }) {
  const [instruction, setInstruction] = useState(lesson.instruction);
  const [resolved, setResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const review = async (approve: boolean) => {
    setBusy(true); setError(null);
    try {
      const api = projectApi(lesson.project_path);
      if (approve) await api.approveLesson(lesson.id, instruction, resolved);
      else await api.rejectLesson(lesson.id);
      onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not review the draft"); }
    finally { setBusy(false); }
  };
  return <article className="cg-knowledge-card">
    <div className="cg-knowledge-card-head"><strong>{lesson.title}</strong><span>{lesson.status} · {lesson.confidence} confidence</span></div>
    <p>{lesson.rationale}</p>
    <p className="cg-empty-note">{lesson.kind} · {lesson.category || "Uncategorized"} · {lesson.scope.join(", ") || "Match source evidence"}</p>
    <details><summary>Source evidence</summary><blockquote>{lesson.evidence}</blockquote><p>Conversation {lesson.session_id.slice(0, 12)}</p></details>
    {lesson.conflicts.length > 0 && <div className="cg-banner"><strong>Conflicts to resolve</strong>{lesson.conflicts.map((c, i) => <p key={i}>{c}</p>)}
      {lesson.status === "draft" && <label><input type="checkbox" checked={resolved} onChange={e => setResolved(e.target.checked)} /> I edited the guidance to resolve these conflicts</label>}
    </div>}
    <label>Guidance<textarea aria-label="Learning instruction" rows={4} value={instruction} disabled={lesson.status !== "draft" || busy} onChange={e => setInstruction(e.target.value)} /></label>
    {error && <p role="alert" className="cg-banner">{error}</p>}
    {lesson.status === "draft" && <div className="cg-knowledge-actions"><button className="cg-btn" disabled={busy} onClick={() => void review(false)}>Reject</button>
      <button className="cg-btn" data-variant="primary" disabled={busy || !instruction.trim() || (!!lesson.conflicts.length && !resolved)} onClick={() => void review(true)}>{busy ? "Saving…" : "Approve for this project"}</button></div>}
  </article>;
}
