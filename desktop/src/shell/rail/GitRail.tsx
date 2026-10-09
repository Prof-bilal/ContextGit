import { useMemo, useState } from "react";
import { LuChevronDown, LuChevronRight, LuFolder, LuGitBranch, LuX } from "react-icons/lu";

import type { Branch, Commit, Session } from "@/lib/api";
import type { Workspace } from "../../../shared/workspace";
import { commitsOnBranch } from "../git/branchCommits";
import { StatusIcon } from "../primitives";

interface ProjectNode {
  path: string;
  name: string;
  sessions: Session[];
}

function projectName(path: string, projects: Workspace[]): string {
  if (!path) return "Unassigned";
  return projects.find((project) => project.path === path)?.name
    ?? path.split(/[\\/]/).filter(Boolean).at(-1)
    ?? path;
}

/** GitHub-style project tree: project first, then the sessions and branches inside it. */
export default function GitRail({
  projects,
  sessions,
  branches,
  commits,
  currentBranch,
  selectedProject,
  selectedBranch,
  onSelectProject,
  onSelectSession,
  onDeleteSession,
  onCheckout,
  onDelete,
}: {
  projects: Workspace[];
  sessions: Session[];
  branches: Branch[];
  commits: Commit[];
  currentBranch: string;
  selectedProject: string;
  selectedBranch: string;
  onSelectProject: (path: string) => void;
  onSelectSession: (session: Session) => void;
  onDeleteSession: (session: Session) => void;
  onCheckout: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const nodes = useMemo<ProjectNode[]>(() => {
    const paths = new Set(projects.map((project) => project.path));
    for (const session of sessions) if (session.project_path) paths.add(session.project_path);
    if (sessions.some((session) => !session.project_path)) paths.add("");
    const needle = query.trim().toLowerCase();
    return [...paths]
      .map((path) => ({
        path,
        name: projectName(path, projects),
        sessions: sessions
          .filter((session) => path ? session.project_path === path : !session.project_path)
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      }))
      .filter((node) => !needle || `${node.name} ${node.path}`.toLowerCase().includes(needle) || node.sessions.some((session) => session.name.toLowerCase().includes(needle)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [projects, sessions, query]);

  const branchCommitCount = (name: string) => {
    const head = branches.find((branch) => branch.name === name)?.head_commit_id;
    return head ? commitsOnBranch(commits, head).length : 0;
  };

  const sessionRow = (session: Session) => {
    const count = branchCommitCount(session.branch);
    const selected = selectedBranch === session.branch;
    return (
      <div className="cg-git-session-row" key={session.id}>
        <button
          type="button"
          className="cg-row cg-git-session"
          aria-current={selected ? "true" : undefined}
          title={`${session.name} · ${session.branch}`}
          onClick={() => onSelectSession(session)}
        >
          <StatusIcon status={session.status} />
          <span className="cg-row-title">{session.name}</span>
          <span className="cg-toolbar-spacer" />
          <span className="cg-commit-hash">{count} commit{count === 1 ? "" : "s"}</span>
        </button>
        <button
          type="button"
          className="cg-icon-btn cg-git-session-delete"
          aria-label={`Move session ${session.name} to Storage`}
          title="Move session to Storage (restorable)"
          onClick={(event) => { event.stopPropagation(); onDeleteSession(session); }}
        >
          <LuX aria-hidden="true" />
        </button>
        <span className="cg-git-session-branch" title={session.branch}><LuGitBranch aria-hidden="true" />{session.branch}</span>
      </div>
    );
  };

  return (
    <nav className="cg-rail cg-git-rail" aria-label="Projects and sessions">
      <div className="cg-rail-head">
        <h2>Projects</h2>
        <span className="cg-count">{projects.length}</span>
      </div>
      <div className="cg-rail-search">
        <input
          type="search"
          placeholder="Filter projects or sessions"
          aria-label="Filter projects or sessions"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <button
        type="button"
        className={`cg-git-all-row ${selectedProject === "" ? "is-selected" : ""}`}
        onClick={() => onSelectProject("")}
      >
        <LuGitBranch aria-hidden="true" />
        <span>All projects</span>
        <span className="cg-toolbar-spacer" />
        <span className="cg-commit-hash">{sessions.length} sessions</span>
      </button>
      {nodes.map((node) => {
        const expanded = open[node.path] ?? node.path === selectedProject;
        const selected = selectedProject === node.path;
        return (
          <section className="cg-git-project" key={node.path}>
            <button
              type="button"
              className={`cg-git-project-row ${selected ? "is-selected" : ""}`}
              aria-expanded={expanded}
              onClick={() => {
                onSelectProject(node.path);
                setOpen((current) => ({ ...current, [node.path]: !expanded }));
              }}
            >
              {expanded ? <LuChevronDown aria-hidden="true" /> : <LuChevronRight aria-hidden="true" />}
              <LuFolder aria-hidden="true" />
              <strong>{node.name}</strong>
              <span className="cg-toolbar-spacer" />
              <span className="cg-commit-hash">{node.sessions.length} session{node.sessions.length === 1 ? "" : "s"}</span>
            </button>
            {expanded && (
              <div className="cg-git-project-sessions">
                <button
                  type="button"
                  className={`cg-git-scope-row ${selected && selectedBranch === "" ? "is-selected" : ""}`}
                  onClick={() => onSelectProject(node.path)}
                >
                  All history
                </button>
                {node.sessions.length === 0 ? <p className="cg-empty-note">No sessions yet.</p> : node.sessions.map(sessionRow)}
              </div>
            )}
          </section>
        );
      })}
      {nodes.length === 0 && <p className="cg-empty-note cg-rail-search">No projects or sessions match.</p>}
      <div className="cg-git-rail-meta"><span>{branches.length} branches</span><span>{commits.length} commits</span></div>
      {selectedBranch && selectedBranch !== currentBranch && (
        <div className="cg-git-rail-actions">
          <button type="button" className="cg-btn cg-btn-sm" onClick={() => onCheckout(selectedBranch)}>Checkout branch</button>
          <button type="button" className="cg-btn cg-btn-sm" onClick={() => onDelete(selectedBranch)}>Move to Storage</button>
        </div>
      )}
    </nav>
  );
}
