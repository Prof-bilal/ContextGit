import { useEffect, useState, type FormEvent } from "react";

import type { Session } from "@/lib/api";
import { AGENTS, DEFAULT_AGENT, agentLabel, agentMonogram } from "../agents";
import { Chip, Monogram, StatusDot } from "../primitives";

/**
 * Runs rail: sessions from the backend grouped by agent CLI (Claude Code ->
 * its runs, Codex -> its runs, ...). "＋ New run" starts a fresh session.
 */
export default function AgentRail({
  sessions,
  openIds,
  activeId,
  onSelect,
  onNew,
  onDelete,
}: {
  sessions: Session[];
  openIds: string[];
  activeId: string | null;
  onSelect: (session: Session) => void;
  onNew: (name: string, agent: string) => Promise<void>;
  onDelete: (session: Session) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [agent, setAgent] = useState(DEFAULT_AGENT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reveal a group the first time it has any runs; the user can collapse it after.
  useEffect(() => {
    setOpen((current) => {
      let changed = false;
      const next = { ...current };
      for (const session of sessions) {
        const key = session.agent ?? "shell";
        if (next[key] === undefined) {
          next[key] = true;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [sessions]);

  const groupIds = [
    ...AGENTS.map((entry) => entry.id),
    ...sessions.map((session) => session.agent ?? "shell").filter((id) => !AGENTS.some((a) => a.id === id)),
  ].filter((id, index, list) => list.indexOf(id) === index);

  const groups = groupIds
    .map((id) => ({ id, items: sessions.filter((session) => (session.agent ?? "shell") === id) }))
    .filter((group) => group.items.length > 0);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await onNew(trimmed, agent);
      setName("");
      setShowForm(false);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the run");
    } finally {
      setBusy(false);
    }
  };

  return (
    <nav className="cg-rail" aria-label="Agent runs">
      <div className="cg-rail-head">
        <h2>Runs</h2>
        <span className="cg-count">{sessions.length}</span>
      </div>
      <button
        type="button"
        className="cg-new-btn"
        aria-expanded={showForm}
        onClick={() => {
          setShowForm((shown) => !shown);
          setError(null);
        }}
      >
        ＋ New run
      </button>
      {showForm && (
        <form className="cg-form" onSubmit={(event) => void submit(event)}>
          <label htmlFor="cg-run-name">Run name</label>
          <input
            id="cg-run-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. fix auth bug"
            autoFocus
          />
          <label htmlFor="cg-run-agent">Agent</label>
          <select id="cg-run-agent" value={agent} onChange={(event) => setAgent(event.target.value)}>
            {AGENTS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
          <p>Gets its own branch and terminal; nothing commits until you do.</p>
          <button type="submit" className="cg-btn" data-variant="primary" disabled={busy || !name.trim()}>
            {busy ? "Starting…" : "Start run"}
          </button>
        </form>
      )}
      {error && (
        <p className="cg-pane-error" role="alert">
          {error}
        </p>
      )}
      {groups.map((group) => {
        const isOpen = open[group.id] ?? false;
        return (
          <section key={group.id} className="cg-group" data-open={isOpen}>
            <button
              type="button"
              className="cg-group-head"
              aria-expanded={isOpen}
              onClick={() => setOpen((current) => ({ ...current, [group.id]: !isOpen }))}
            >
              <span className="cg-group-caret" aria-hidden="true">
                ▶
              </span>
              <Monogram agent={group.id} label={agentMonogram(group.id)} />
              <span className="cg-group-name">{agentLabel(group.id)}</span>
            </button>
            <div className="cg-group-items">
              <div>
                {group.items.map((session) => (
                  <div key={session.id} className="cg-row-wrap">
                    <button
                      type="button"
                      className="cg-row"
                      aria-current={session.id === activeId}
                      title={session.branch}
                      onClick={() => onSelect(session)}
                    >
                      <StatusDot status={session.status} />
                      <span className="cg-row-title">{session.name}</span>
                      <span className="cg-toolbar-spacer" />
                      {openIds.includes(session.id) && <Chip tone="ok">live</Chip>}
                    </button>
                    <button
                      type="button"
                      className="cg-icon-btn cg-row-delete"
                      aria-label={`Delete run ${session.name}`}
                      title="Delete run"
                      onClick={() => onDelete(session)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </section>
        );
      })}
      {sessions.length === 0 && (
        <p className="cg-empty-note cg-rail-search">
          No runs yet. Start one — it gets its own branch and terminal.
        </p>
      )}
    </nav>
  );
}
