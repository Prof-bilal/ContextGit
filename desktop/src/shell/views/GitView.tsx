import { lazy, Suspense, useState } from "react";
import type { IconType } from "react-icons";
import { LuCircle, LuCircleDot, LuGitMerge, LuPencilLine } from "react-icons/lu";

import type { Branch, Commit, RepoSnapshot } from "@/lib/api";
import { Chip, MiniSeg } from "../primitives";
import type { CommitFilter } from "../rail/GitRail";

// React Flow is heavy and only needed in the graph view.
const CommitGraph = lazy(() => import("../git/CommitGraph"));

const KIND_ICON: Record<Commit["kind"], IconType> = {
  root: LuCircleDot,
  normal: LuCircle,
  merge: LuGitMerge,
  note: LuPencilLine,
};

const VIEW_OPTIONS = [
  { value: "list" as const, label: "List" },
  { value: "graph" as const, label: "Graph" },
];

function relativeTime(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** History over the real commit DAG. */
export default function GitView({
  branches,
  commits,
  allCommits,
  branch,
  selectedId,
  onSelect,
  filter,
  tags,
  loading,
  onRefresh,
}: {
  branches: Branch[];
  commits: Commit[];
  /** Every commit in the repo — the graph draws the whole DAG, not one branch. */
  allCommits: Commit[];
  branch: string;
  selectedId: string | null;
  onSelect: (commit: Commit) => void;
  filter: CommitFilter;
  tags: RepoSnapshot["tags"];
  loading: boolean;
  onRefresh: () => void;
}) {
  const [view, setView] = useState<"list" | "graph">("list");

  const branchesAt = (commitId: string) =>
    branches.filter((branch) => branch.head_commit_id === commitId).map((branch) => branch.name);

  const visible = filter === "all" ? commits : commits.filter((commit) => commit.kind === filter);

  return (
    <>
      <div className="cg-view-toolbar">
        <h1>History</h1>
        {branch && <Chip>{branch}</Chip>}
        <span className="cg-view-sub">
          {visible.length} commit{visible.length === 1 ? "" : "s"}
        </span>
        {tags.length > 0 && <Chip>{tags.length} tag{tags.length === 1 ? "" : "s"}</Chip>}
        <span className="cg-toolbar-spacer" />
        <button type="button" className="cg-btn cg-btn-sm" onClick={onRefresh}>
          Refresh
        </button>
        <MiniSeg value={view} options={VIEW_OPTIONS} onChange={setView} label="History view" />
      </div>
      <div className="cg-view-body">
        {loading ? (
          <div className="cg-doc">
            <p className="cg-empty-note">Loading commits…</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="cg-doc">
            <p className="cg-empty-note">
              No commits on {branch || "this branch"} here yet. Run an agent in the Code tab and
              checkpoint it — it lands in this history.
            </p>
          </div>
        ) : view === "list" ? (
          <div className="cg-doc">
            <ol className="cg-commit-list" aria-label="Commit history">
              {visible.map((commit) => {
                const labels = branchesAt(commit.id);
                const KindIcon = KIND_ICON[commit.kind];
                return (
                  <li key={commit.id}>
                    <button
                      type="button"
                      className="cg-commit"
                      aria-current={commit.id === selectedId}
                      onClick={() => onSelect(commit)}
                    >
                      <span className="cg-kind" data-kind={commit.kind} aria-hidden="true">
                        <KindIcon />
                      </span>
                      <span className="cg-commit-copy">
                        <span className="cg-commit-summary">
                          {commit.summary ??
                            commit.messages.at(-1)?.content.slice(0, 90) ??
                            "empty commit"}
                        </span>
                        <span className="cg-commit-sub">
                          <span className="cg-commit-hash">{commit.id.slice(0, 7)}</span>
                          <span>{commit.model}</span>
                          {labels.map((name) => (
                            <Chip key={name}>{name}</Chip>
                          ))}
                        </span>
                      </span>
                      <span
                        className="cg-commit-hash"
                        title={new Date(commit.created_at).toLocaleString()}
                      >
                        {relativeTime(commit.created_at)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : (
          <div className="cg-graph-wrap">
            <Suspense
              fallback={
                <div className="cg-graph-placeholder">
                  <strong>Loading graph…</strong>
                </div>
              }
            >
              <CommitGraph
                commits={allCommits}
                branches={branches}
                selectedId={selectedId}
                onSelect={(id) => {
                  const commit = allCommits.find((entry) => entry.id === id);
                  if (commit) onSelect(commit);
                }}
              />
            </Suspense>
          </div>
        )}
      </div>
    </>
  );
}
