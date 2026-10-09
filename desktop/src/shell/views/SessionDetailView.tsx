import { useEffect, useState, type ReactNode } from "react";
import { api, type Session, type SessionDetail } from "@/lib/api";
import { Chip, Field, StatusIcon } from "../primitives";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="cg-session-detail-section"><header><span className="cg-kicker">{title}</span></header>{children}</section>;
}

function MessageList({ messages }: { messages: SessionDetail["messages"] }) {
  if (messages.length === 0) return <p className="cg-empty-note">No committed conversation yet.</p>;
  return <div className="cg-session-detail-messages">{messages.map((message, index) => (
    <article className={`cg-session-detail-message cg-session-detail-message-${message.role}`} key={`${message.created_at ?? "message"}-${index}`}>
      <span>{message.role}</span>
      <p>{message.content}</p>
    </article>
  ))}</div>;
}

export default function SessionDetailView({
  session,
  onBack,
  onRefresh,
}: {
  session: Session;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setError(null);
    void api.sessionDetail(session.id).then((value) => {
      if (alive) setDetail(value);
    }).catch((cause: unknown) => {
      if (alive) setError(cause instanceof Error ? cause.message : "Could not load session detail");
    });
    return () => { alive = false; };
  }, [session.id]);

  return (
    <div className="cg-session-detail">
      <header className="cg-session-detail-toolbar">
        <button type="button" className="cg-btn cg-btn-sm" onClick={onBack}>← Project history</button>
        <span className="cg-toolbar-spacer" />
        <button type="button" className="cg-btn cg-btn-sm" onClick={onRefresh}>Refresh</button>
      </header>
      <header className="cg-session-detail-header">
        <div>
          <span className="cg-kicker">AI session</span>
          <h1>{session.name}</h1>
          <p className="cg-view-sub">{session.project_path ?? "Unassigned project"} · {session.branch}</p>
        </div>
        <div className="cg-inline cg-session-detail-status"><StatusIcon status={session.status} /><Chip>{session.status}</Chip></div>
      </header>
      {error && <p className="cg-banner" role="alert">{error}</p>}
      {!detail && !error && <p className="cg-empty-note">Loading the session record…</p>}
      {detail && <div className="cg-session-detail-grid">
        <main>
          <Section title="Conversation"><MessageList messages={[...detail.messages, ...detail.staged_messages]} /></Section>
          {detail.agent_run && <Section title="Execution">
            <div className="cg-session-detail-run-head"><strong>{detail.agent_run.task}</strong><Chip>{detail.agent_run.status}</Chip></div>
            {detail.agent_run.plan?.summary && <p>{detail.agent_run.plan.summary}</p>}
            <div className="cg-session-detail-steps">{detail.agent_run.steps.map((step) => <div className="cg-session-detail-step" key={step.id}><StatusIcon status={step.status === "done" ? "done" : step.status === "failed" ? "error" : "running"} /><div><strong>{step.kind}</strong><p>{step.output_summary || step.input_summary || "No details"}</p></div></div>)}</div>
            {detail.agent_run.error && <p className="cg-banner" role="alert">{detail.agent_run.error}</p>}
          </Section>}
          <Section title="Commits">
            {detail.commits.length === 0 ? <p className="cg-empty-note">No commits on this session yet.</p> : <ol className="cg-session-detail-commits">{detail.commits.map((commit) => <li key={commit.id}><span className="cg-mono">{commit.id.slice(0, 7)}</span><strong>{commit.summary ?? "Commit"}</strong><span className="cg-view-sub">{commit.messages.length} messages</span></li>)}</ol>}
          </Section>
        </main>
        <aside>
          <Section title="Session facts"><div className="cg-fields"><Field label="Agent">{session.agent ?? "—"}</Field><Field label="Role">{session.role ?? "—"}</Field><Field label="Model">{detail.agent_run?.model ?? "—"}</Field><Field label="Scope">{session.scope.length ? session.scope.join(", ") : "No scope claimed"}</Field><Field label="Skills">{session.skills.length ? session.skills.join(", ") : "None recorded"}</Field><Field label="Staged">{detail.staged_messages.length} messages</Field></div></Section>
          <Section title="Files"><div className="cg-session-detail-files">{detail.workspace_status?.changed_files.length ? detail.workspace_status.changed_files.map((file) => <code key={file}>{file}</code>) : <p className="cg-empty-note">No changed files reported.</p>}</div></Section>
          <Section title="Project memory"><p className="cg-empty-note">{detail.project_memory_preview ? `Loaded revision ${detail.project_memory_preview.revision}` : "No approved project memory yet."}</p>{detail.project_memory_preview?.summary && <p>{detail.project_memory_preview.summary}</p>}</Section>
        </aside>
      </div>}
    </div>
  );
}
