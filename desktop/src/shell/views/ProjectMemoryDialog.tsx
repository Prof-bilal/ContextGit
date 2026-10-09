import type { ProjectMemoryRevision } from "@/lib/api";

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return <section className="cg-memory-preview-section"><span className="cg-kicker">{title}</span><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></section>;
}

export default function ProjectMemoryDialog({
  projectName,
  memory,
  busy,
  error,
  onApprove,
  onClose,
}: {
  projectName: string;
  memory: ProjectMemoryRevision | null;
  busy: boolean;
  error: string | null;
  onApprove: () => void;
  onClose: () => void;
}) {
  return (
    <div className="cg-memory-modal-backdrop" role="presentation">
      <section className="cg-memory-modal" role="dialog" aria-modal="true" aria-labelledby="cg-memory-title">
        <header className="cg-memory-modal-head"><div><span className="cg-kicker">Project knowledge preview</span><h2 id="cg-memory-title">Synthesize {projectName}</h2></div><button type="button" className="cg-icon-btn" aria-label="Close" onClick={onClose}>×</button></header>
        {error && <p className="cg-banner" role="alert">{error}</p>}
        {!memory && !error && <p className="cg-empty-note">Reading the project sessions…</p>}
        {memory && <div className="cg-memory-preview">
          <p className="cg-memory-summary">{memory.summary || "No summary was generated."}</p>
          <div className="cg-memory-sources"><ChipLabel label={`${memory.source_session_ids.length} source sessions`} /><ChipLabel label={`${memory.source_commit_ids.length} source commits`} /><ChipLabel label={`revision ${memory.revision}`} /></div>
          <List title="Architecture" items={memory.architecture} /><List title="Workflow" items={memory.workflow} /><List title="Conventions" items={memory.conventions} /><List title="Decisions" items={memory.decisions} /><List title="Rejected approaches" items={memory.rejected} /><List title="Required skills" items={memory.skills} /><List title="Validation" items={memory.validation} /><List title="Open questions" items={memory.open_questions} />
          {memory.conflicts.length > 0 && <section className="cg-memory-conflicts"><span className="cg-kicker">Conflicts requiring attention</span>{memory.conflicts.map((conflict) => <article key={`${conflict.topic}-${conflict.proposed}`}><strong>{conflict.topic}</strong><p>Existing: {conflict.existing}</p><p>Proposed: {conflict.proposed}</p></article>)}</section>}
        </div>}
        <footer className="cg-memory-modal-foot"><button type="button" className="cg-btn" onClick={onClose}>Cancel</button><button type="button" className="cg-btn" data-variant="primary" disabled={!memory || busy} onClick={onApprove}>{busy ? "Saving…" : "Approve knowledge"}</button></footer>
      </section>
    </div>
  );
}

function ChipLabel({ label }: { label: string }) {
  return <span className="cg-chip">{label}</span>;
}
