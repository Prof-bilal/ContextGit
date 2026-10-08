import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  LuCheck,
  LuChevronDown,
  LuChevronRight,
  LuFolder,
  LuFolderPlus,
  LuPlus,
  LuX,
} from "react-icons/lu";

import { api, type FleetEntry, type HarnessLimits, type Session } from "@/lib/api";
import type { Workspace } from "../../../shared/workspace";
import { ROLE_BY_ID, ROLES, roleFor, roleShort, roleSkills } from "../../../shared/roles";
import { AGENTS, DEFAULT_AGENT, agentLabel, agentMonogram } from "../agents";
import { AgentMark, Chip, StatusIcon } from "../primitives";

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

/** Compact role label for a run row; the full role stays in the tooltip. */
function roleChipLabel(role: string): string {
  const match = roleFor(role);
  return match ? roleShort(match) : role;
}

/** The last path segment of a project folder ("/home/me/warden" -> "warden"). */
function baseName(projectPath: string): string {
  const parts = projectPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? projectPath;
}

/** Recover the project folder from a run's worktree path, when it has one. */
function projectFromWorktree(worktree: string | null): string | null {
  if (!worktree) return null;
  const match = worktree.match(/^(.*)[\\/]\.contextgit[\\/]worktrees[\\/][^\\/]+$/);
  return match ? match[1] : null;
}

/** The project a run belongs to (falls back to its worktree, else the unknown bucket). */
function projectKey(session: Session, fallback: string | null): string {
  return session.project_path ?? projectFromWorktree(session.worktree_path) ?? fallback ?? "";
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

interface AgentGroup {
  id: string;
  items: Session[];
}

interface ProjectNode {
  /** Collapse key: the project path, or "" for the unknown bucket. */
  key: string;
  path: string | null;
  name: string;
  sessions: Session[];
  groups: AgentGroup[];
}

/**
 * Runs rail: sessions from the backend grouped by project, then by agent CLI
 * (warden → Claude Code → its runs, ...). A project dropdown in the header
 * switches the active project (or opens a new folder).
 */
export default function ProjectsRail({
  sessions,
  backendAvailable = true,
  fleet,
  openIds,
  activeId,
  limits,
  projects,
  activePath,
  onSelect,
  onNew,
  onDelete,
  onUseProject,
  onForgetProject,
  onChooseProject,
}: {
  sessions: Session[];
  backendAvailable?: boolean;
  fleet: FleetEntry[];
  openIds: string[];
  activeId: string | null;
  /** Each harness's account limits, keyed by harness id (cmd, cline). */
  limits: Record<string, HarnessLimits>;
  /** Every remembered project folder. */
  projects: Workspace[];
  activePath: string | null;
  onSelect: (session: Session) => void;
  onNew: (name: string, agent: string, scope: string[], roleId: string) => Promise<void>;
  onDelete: (session: Session) => void;
  onUseProject: (path: string) => void;
  onForgetProject: (path: string) => void;
  onChooseProject: () => void;
}) {
  const fleetById = new Map(fleet.map((entry) => [entry.session_id, entry]));
  const [projOpen, setProjOpen] = useState<Record<string, boolean>>({});
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [agent, setAgent] = useState(DEFAULT_AGENT);
  const [roleId, setRoleId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scopeText, setScopeText] = useState("");
  const [claimConflicts, setClaimConflicts] = useState<string[]>([]);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const activeRole = roleId ? ROLE_BY_ID[roleId] : undefined;
  const activeProject = projects.find((project) => project.path === activePath) ?? null;

  // Build the Project → agent → runs tree.
  const nodes = useMemo<ProjectNode[]>(() => {
    const fallback = activePath ?? projects[0]?.path ?? null;
    const byProject = new Map<string, Session[]>();
    for (const session of sessions) {
      const key = projectKey(session, fallback);
      byProject.set(key, [...(byProject.get(key) ?? []), session]);
    }
    const result: ProjectNode[] = [];
    const seen = new Set<string>();
    const add = (path: string | null) => {
      const key = path ?? "";
      if (seen.has(key)) return;
      seen.add(key);
      const items = byProject.get(key) ?? [];
      const ids = [
        ...AGENTS.map((entry) => entry.id),
        ...items
          .map((session) => session.agent ?? "shell")
          .filter((id) => !AGENTS.some((entry) => entry.id === id)),
      ].filter((id, index, list) => list.indexOf(id) === index);
      const groups = ids
        .map((id) => ({ id, items: items.filter((session) => (session.agent ?? "shell") === id) }))
        .filter((group) => group.items.length > 0);
      result.push({ key, path, name: path ? baseName(path) : "Other", sessions: items, groups });
    };
    if (activePath) add(activePath);
    for (const project of projects) add(project.path);
    for (const key of byProject.keys()) if (key) add(key);
    if (byProject.has("")) add(null);
    return result;
  }, [sessions, projects, activePath]);

  // Reveal a project (and its groups) the first time it appears; user can collapse.
  useEffect(() => {
    setProjOpen((current) => {
      let changed = false;
      const next = { ...current };
      for (const node of nodes) {
        if (next[node.key] === undefined) {
          next[node.key] = node.sessions.length > 0 || node.path === activePath;
          changed = true;
        }
      }
      return changed ? next : current;
    });
    setGroupOpen((current) => {
      let changed = false;
      const next = { ...current };
      for (const node of nodes) {
        for (const group of node.groups) {
          const key = `${node.key}::${group.id}`;
          if (next[key] === undefined) {
            next[key] = true;
            changed = true;
          }
        }
      }
      return changed ? next : current;
    });
  }, [nodes, activePath]);

  // Close the project menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

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

  const conflictNames = claimConflicts.map(
    (id) => sessions.find((session) => session.id === id)?.name ?? id,
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy || !backendAvailable) return;
    setBusy(true);
    try {
      await onNew(trimmed, agent, parseScope(scopeText), roleId);
      setName("");
      setScopeText("");
      setRoleId("");
      setShowForm(false);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the run");
    } finally {
      setBusy(false);
    }
  };

  return (
    <nav className="cg-rail" aria-label="Projects and runs">
      <div className="cg-rail-head">
        <h2>Projects</h2>
        <span className="cg-count">{sessions.length}</span>
      </div>

      <div className="cg-project-menu-wrap" ref={menuRef}>
        <button
          type="button"
          className="cg-project-menu"
          aria-haspopup="true"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <LuFolder aria-hidden="true" />
          <span className="cg-project-menu-name">{activeProject?.name ?? "Choose project"}</span>
          <LuChevronDown aria-hidden="true" className="cg-project-menu-caret" />
        </button>
        {menuOpen && (
          <div className="cg-project-pop" role="group" aria-label="Projects">
            {projects.map((project) => (
              <div key={project.path} className="cg-project-pop-row">
                <button
                  type="button"
                  className="cg-project-pop-pick"
                  aria-current={project.path === activePath ? "true" : undefined}
                  onClick={() => {
                    onUseProject(project.path);
                    setMenuOpen(false);
                  }}
                >
                  <LuFolder aria-hidden="true" />
                  <span className="cg-project-pop-name">{project.name}</span>
                  {project.path === activePath && <LuCheck aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  className="cg-icon-btn cg-project-pop-forget"
                  aria-label={`Forget ${project.name}`}
                  title="Forget this project"
                  onClick={() => onForgetProject(project.path)}
                >
                  <LuX aria-hidden="true" />
                </button>
              </div>
            ))}
            {projects.length === 0 && <p className="cg-empty-note">No projects yet.</p>}
            <button type="button" className="cg-project-pop-add" onClick={onChooseProject}>
              <LuFolderPlus aria-hidden="true" /> Open folder…
            </button>
          </div>
        )}
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
          <label htmlFor="cg-run-role">Role</label>
          <select
            id="cg-run-role"
            value={roleId}
            onChange={(event) => setRoleId(event.target.value)}
          >
            <option value="">No role</option>
            {ROLES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
          {activeRole && (
            <div className="cg-role-skills" role="note">
              <span className="cg-kicker">Auto-loaded skills</span>
              <ul>
                {roleSkills(activeRole).map((skill) => (
                  <li key={skill.id} title={skill.brief}>
                    {skill.label}
                  </li>
                ))}
              </ul>
            </div>
          )}
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
          <button type="submit" className="cg-btn" data-variant="primary" disabled={busy || !name.trim() || !backendAvailable}>
            {busy ? "Starting…" : "Start run"}
          </button>
        </form>
      )}
      {error && (
        <p className="cg-pane-error" role="alert">
          {error}
        </p>
      )}

      {nodes.map((node) => {
        const isOpen = projOpen[node.key] ?? false;
        return (
          <section
            key={node.key}
            className="cg-group cg-project-group"
            data-open={isOpen}
            data-active={node.path === activePath}
          >
            <button
              type="button"
              className="cg-group-head cg-project-head"
              aria-expanded={isOpen}
              onClick={() => setProjOpen((current) => ({ ...current, [node.key]: !isOpen }))}
            >
              <span className="cg-group-caret" aria-hidden="true">
                <LuChevronRight />
              </span>
              <LuFolder aria-hidden="true" className="cg-project-icon" />
              <span className="cg-group-name">{node.name}</span>
              {node.path === activePath && (
                <span className="cg-project-active" title="Active project">
                  active
                </span>
              )}
              <span className="cg-toolbar-spacer" />
              <span className="cg-count">{node.sessions.length}</span>
            </button>
            <div className="cg-group-items">
              <div>
                {node.groups.map((group) => {
                  const groupKey = `${node.key}::${group.id}`;
                  const groupIsOpen = groupOpen[groupKey] ?? false;
                  return (
                    <section key={groupKey} className="cg-subgroup" data-open={groupIsOpen}>
                      <button
                        type="button"
                        className="cg-subgroup-head"
                        aria-expanded={groupIsOpen}
                        onClick={() =>
                          setGroupOpen((current) => ({ ...current, [groupKey]: !groupIsOpen }))
                        }
                      >
                        <span className="cg-group-caret" aria-hidden="true">
                          <LuChevronRight />
                        </span>
                        <AgentMark agent={group.id} label={agentMonogram(group.id)} />
                        <span className="cg-subgroup-name">{agentLabel(group.id)}</span>
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
                                {session.role && (
                                  <Chip>
                                    <span className="cg-role-chip" title={session.role}>
                                      {roleChipLabel(session.role)}
                                    </span>
                                  </Chip>
                                )}
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
                {node.groups.length === 0 && (
                  <p className="cg-empty-note cg-project-empty">No runs yet.</p>
                )}
              </div>
            </div>
          </section>
        );
      })}

      {nodes.length === 0 && (
        <p className="cg-empty-note cg-rail-search">
          No runs yet. Start one — it gets its own branch and terminal.
        </p>
      )}
    </nav>
  );
}
