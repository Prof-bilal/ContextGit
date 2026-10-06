import { useEffect, useState, type FormEvent } from "react";

import { api, type FleetEntry, type HarnessLimits, type Session } from "@/lib/api";
import { AGENTS, DEFAULT_AGENT, agentLabel, agentMonogram } from "../agents";
import { AgentMark, Chip, StatusIcon } from "../primitives";
import { LuChevronRight, LuPlus, LuX } from "react-icons/lu";

/** Compact "5-hour 16%" badge for a harness's tightest limit window. */
function limitBadge(limits: HarnessLimits | undefined): string | null {
  if (!limits?.signed_in) return null;
  const windows = limits.windows.filter((window) => window.cap > 0);
  if (windows.length === 0) return null;
  const worst = windows.reduce((a, b) => (b.used / b.cap > a.used / a.cap ? b : a));
  return `${worst.label} ${Math.round((worst.used / worst.cap) * 100)}%`;
}

/** "src/api/**, docs/**" -> ["src/api/**", "docs/**"]. */
function parseScope(text: string): string[] {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Tooltip for a run row: branch, worktree, changed files and overlap. */
function fleetTitle(session: Session, entry: FleetEntry | undefined): string {
  if (!entry) return session.branch;
  const parts = [session.branch];
  if (entry.git_branch) {
    parts.push(entry.behind > 0 ? `${entry.git_branch} (behind ${entry.behind})` : entry.git_branch);
  }
  if (entry.changed_files.length > 0) parts.push(`${entry.changed_files.length} files changed`);
  if (entry.overlaps.length > 0) parts.push(`${entry.overlaps.length} overlapping run(s)`);
  if (!entry.clean) parts.push("merge conflicts");
  return parts.join(" · ");
}

/**
 * Runs rail: sessions from the backend grouped by agent CLI (Claude Code ->
 * its runs, Codex -> its runs, ...). "New run" starts a fresh session.
 */
export default function AgentRail({
  sessions,
  fleet,
  openIds,
  activeId,
  limits,
  onSelect,
  onNew,
  onDelete,
}: {
  sessions: Session[];
  fleet: FleetEntry[];
  openIds: string[];
  activeId: string | null;
  /** Each harness's account limits, keyed by harness id (cmd, cline). */
  limits: Record<string, HarnessLimits>;
  onSelect: (session: Session) => void;
  onNew: (name: string, agent: string, scope: string[]) => Promise<void>;
  onDelete: (session: Session) => void;
}) {
  const fleetById = new Map(fleet.map((entry) => [entry.session_id, entry]));
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [agent, setAgent] = useState(DEFAULT_AGENT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scopeText, setScopeText] = useState("");
  const [claimConflicts, setClaimConflicts] = useState<string[]>([]);
  const [scopeError, setScopeError] = useState<string | null>(null);

  // Warn as you type when the claimed files overlap another run's scope.
  useEffect(() => {
    const scope = parseScope(scopeText);
    if (scope.length === 0) {
      setClaimConflicts([]);
      setScopeError(null);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      void api
        .checkClaims(scope)
        .then((result) => {
          if (alive) {
            setClaimConflicts(result.conflicts);
            setScopeError(null);
          }
        })
        .catch((cause: unknown) => {
          // Don't let a failed check read as "no overlap": say so instead.
          if (alive) {
            setClaimConflicts([]);
            setScopeError(cause instanceof Error ? cause.message : "Could not check file claims");
          }
        });
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [scopeText]);

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

  const conflictNames = claimConflicts.map(
    (id) => sessions.find((session) => session.id === id)?.name ?? id,
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await onNew(trimmed, agent, parseScope(scopeText));
      setName("");
      setScopeText("");
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
        <LuPlus aria-hidden="true" /> New run
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
          <label htmlFor="cg-run-scope">Own files (optional)</label>
          <input
            id="cg-run-scope"
            value={scopeText}
            onChange={(event) => setScopeText(event.target.value)}
            placeholder="e.g. src/api/**, docs/**"
          />
          {conflictNames.length > 0 && (
            <p className="cg-form-warn" role="status">
              Overlaps {conflictNames.join(", ")} — they claim the same files.
            </p>
          )}
          {scopeError && (
            <p className="cg-form-warn" role="alert">
              {scopeError}
            </p>
          )}
          <p>Gets its own branch, terminal and worktree; nothing commits until you do.</p>
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
                <LuChevronRight />
              </span>
              <AgentMark agent={group.id} label={agentMonogram(group.id)} />
              <span className="cg-group-name">{agentLabel(group.id)}</span>
              {limitBadge(limits[group.id]) && (
                <span className="cg-group-limits">{limitBadge(limits[group.id])}</span>
              )}
            </button>
            <div className="cg-group-items">
              <div>
                {group.items.map((session) => (
                  <div key={session.id} className="cg-row-wrap">
                    <button
                      type="button"
                      className="cg-row"
                      aria-current={session.id === activeId}
                      title={fleetTitle(session, fleetById.get(session.id))}
                      onClick={() => onSelect(session)}
                    >
                      <StatusIcon status={session.status} />
                      <span className="cg-row-title">{session.name}</span>
                      <span className="cg-toolbar-spacer" />
                      {(fleetById.get(session.id)?.overlaps.length ?? 0) > 0 && (
                        <Chip tone="warn">overlap</Chip>
                      )}
                      {(fleetById.get(session.id)?.changed_files.length ?? 0) > 0 && (
                        <Chip>{fleetById.get(session.id)?.changed_files.length} files</Chip>
                      )}
                      {openIds.includes(session.id) && <Chip tone="ok">live</Chip>}
                    </button>
                    <button
                      type="button"
                      className="cg-icon-btn cg-row-delete"
                      aria-label={`Delete run ${session.name}`}
                      title="Delete run"
                      onClick={() => onDelete(session)}
                    >
                      <LuX aria-hidden="true" />
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
