import { useEffect, useRef, useState } from "react";
import { projectApi, type Session } from "@/shared/api";
import type { Checkpoint, Feedback, FeedbackTag, Lesson, LearningSettings } from "../../../shared/knowledge";
import Modal from "../Modal";
import LessonReview from "./LessonReview";
import ProviderSettings from "./ProviderSettings";
import { flushSessionTranscript } from "../terminal/transcriptFlush";

const TAGS: FeedbackTag[] = ["incorrect", "incomplete", "too slow", "unsafe", "confusing", "excellent"];

export default function CheckpointDialog({ session, closing, onCancel, onFinish }: {
  session: Session; closing: boolean; onCancel: () => void; onFinish: () => void;
}) {
  const api = projectApi(session.project_path ?? undefined);
  const [checkpoint, setCheckpoint] = useState<Checkpoint | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [feedback, setFeedback] = useState<Feedback>({ rating: null, tags: [], note: "", category: session.category ?? "" });
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [settings, setSettings] = useState<LearningSettings | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [provider, setProvider] = useState("");
  const callbacks = useRef({ onFinish }); callbacks.current = { onFinish };
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    void (async () => {
      await flushSessionTranscript(session.id);
      const result = await api.checkpoint(session.id);
      if (!alive) return;
      if (closing && (!result.checkpoint || (!result.changed && !result.checkpoint.warning))) {
        callbacks.current.onFinish(); return;
      }
      setCheckpoint(result.checkpoint);
      setMarkdown(result.checkpoint?.markdown ?? "");
      if (result.checkpoint) setFeedback({ ...result.checkpoint.feedback, category: result.checkpoint.category });
    })().catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : "Could not save checkpoint"); })
      .finally(() => { if (alive) setLoading(false); });
    void api.learningSettings().then(value => { if (alive) { setSettings(value); setConnectionError(null); } })
      .catch(() => { if (alive) setConnectionError("Could not load the AI connection. Open setup to retry."); });
    return () => { alive = false; };
  }, [session.id, closing, attempt]);

  const providers = settings?.providers.filter(p => p.configured) ?? [];
  const defaultProvider = providers.find(p => p.id === settings?.default_provider);
  const aiReady = !!settings && (provider ? providers.some(p => p.id === provider) : !!defaultProvider || settings.app_default);

  const save = async (learn: boolean) => {
    if (!checkpoint) return false;
    setBusy(true); setError(null); setSaved("");
    try {
      await api.feedback(session.id, feedback);
      const exported = await api.exportCheckpoint(session.id, checkpoint.id, markdown);
      setCheckpoint(exported); setMarkdown(exported.markdown);
      setSaved(`Saved to ${exported.artifact_path}`);
      if (learn) setLesson(await api.learningDraft(session.id, provider || undefined));
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this conversation"); return false; }
    finally { setBusy(false); }
  };
  return <Modal title={closing ? "Finish this conversation" : "Conversation checkpoint"} subtitle={session.name} size="lg" onClose={() => { if (!busy && !setupOpen) onCancel(); }}>
    <div className="cg-knowledge-form">
      {loading && <p role="status">Saving the latest conversation…</p>}
      {error && <p role="alert" className="cg-banner">{error} {!checkpoint && <button className="cg-btn" onClick={() => setAttempt(v => v + 1)}>Retry capture</button>}</p>}
      {!loading && !checkpoint && !error && <p>No recorded conversation yet. You can resume this task later.</p>}
      {checkpoint && <>
        <p className="cg-empty-note">Checkpoint saved in ContextGit. Review the Markdown before writing it to your project.</p>
        {checkpoint.warning && <p className="cg-banner" role="status">{checkpoint.warning}</p>}
        {checkpoint.redactions > 0 && <p role="status">{checkpoint.redactions} obvious secret{checkpoint.redactions === 1 ? "" : "s"} redacted. Review for other private information.</p>}
        <fieldset disabled={busy}><legend>How did this task go? <small>(optional)</small></legend><div className="cg-rating" role="group" aria-label="Task rating">
          {[1, 2, 3, 4, 5].map(n => <button type="button" className="cg-btn" key={n} aria-pressed={feedback.rating === n} onClick={() => setFeedback(f => ({ ...f, rating: f.rating === n ? null : n }))}>{n}</button>)}<span>1 Needs work · 5 Excellent</span>
        </div><div className="cg-feedback-tags">{TAGS.map(tag => <label key={tag}><input type="checkbox" checked={feedback.tags.includes(tag)} onChange={e => setFeedback(f => ({ ...f, tags: e.target.checked ? [...f.tags, tag] : f.tags.filter(t => t !== tag) }))} />{tag}</label>)}</div></fieldset>
        <label>Category<input maxLength={80} value={feedback.category} onChange={e => setFeedback(f => ({ ...f, category: e.target.value }))} placeholder="e.g. Authentication" /></label>
        <label>What should improve? <small>(optional)</small><textarea rows={2} maxLength={4000} value={feedback.note} onChange={e => setFeedback(f => ({ ...f, note: e.target.value }))} /></label>
        <details open><summary>Markdown preview</summary><textarea className="cg-markdown-preview" aria-label="Markdown preview" rows={10} value={markdown} maxLength={300000} onChange={e => setMarkdown(e.target.value)} /></details>
        <label>Learning provider<select disabled={busy || setupOpen} value={provider} onChange={e => setProvider(e.target.value)}><option value="">{defaultProvider ? `Project default · ${defaultProvider.label}` : settings?.app_default ? "App default" : "Choose an AI connection"}</option>{providers.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
        {connectionError && <p role="status">{connectionError}</p>}
        {!aiReady && <p className="cg-empty-note">Set up your AI provider to enable cleaning and learning. Saving this conversation works without AI.</p>}
        {!setupOpen && <button type="button" className="cg-btn" disabled={busy} onClick={() => setSetupOpen(true)}>{aiReady ? "Manage AI connection" : "Set up AI connection"}</button>}
        {setupOpen && session.project_path && <ProviderSettings projectPath={session.project_path} onClose={() => setSetupOpen(false)} onSaved={value => {
          setSettings(value); setProvider(""); setConnectionError(null); setSetupOpen(false); setSaved("AI connection saved for this project.");
        }} />}
        <p className="cg-empty-note">Generate a draft to extract reusable guidance. Approval is required before future agents use it.</p>
        {saved && <p role="status">{saved}</p>}
        <div className="cg-knowledge-actions">
          <button className="cg-btn" disabled={busy || setupOpen || !aiReady} onClick={() => {
            setBusy(true); setError(null);
            void api.feedback(session.id, feedback).then(() => api.cleanCheckpoint(session.id, provider || undefined))
              .then(result => setMarkdown(result.markdown)).catch(cause => setError(cause instanceof Error ? cause.message : "Could not clean the conversation"))
              .finally(() => setBusy(false));
          }}>Clean with AI</button>
          <button className="cg-btn" disabled={busy || setupOpen} onClick={() => void save(false)}>{busy ? "Working…" : "Save Markdown & feedback"}</button>
          <button className="cg-btn" disabled={busy || setupOpen || !aiReady} onClick={() => void save(true)}>Generate learning draft</button>
        </div>
        {lesson && <LessonReview key={lesson.id + lesson.status} lesson={lesson} onChanged={() => {
          void api.knowledge(session.project_path!).then(k => setLesson(k.lessons.find(l => l.id === lesson.id) ?? null)).catch(cause => setError(String(cause)));
        }} />}
      </>}
      <div className="cg-knowledge-actions">
        <button className="cg-btn" disabled={busy || setupOpen} onClick={onCancel}>{closing ? "Keep working" : "Done"}</button>
        {closing && <button className="cg-btn" data-variant="primary" disabled={busy || setupOpen || loading || (!checkpoint && !!error)} onClick={() => {
          if (!checkpoint) { onFinish(); return; }
          void save(false).then(ok => { if (ok) onFinish(); });
        }}>Close conversation</button>}
      </div>
    </div>
  </Modal>;
}
