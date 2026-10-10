import { lazy, Suspense, useMemo, useState } from "react";
import type { IconType } from "react-icons";
import { LuCircle, LuCircleDot, LuGitMerge, LuPencilLine } from "react-icons/lu";

import type { Branch, Commit, RepoSnapshot } from "@/lib/api";
import type { ActivityDay } from "../charts/ActivityHeatmap";
import { Chip, MiniSeg } from "../primitives";

// React Flow is heavy and only needed in the graph view.
const CommitGraph = lazy(() => import("../git/CommitGraph"));
const LaneGraph = lazy(() => import("../git/LaneGraph"));
const ActivityHeatmap = lazy(() => import("../charts/ActivityHeatmap"));

/** Which commit kinds the history list shows. */
export type CommitFilter = "all" | "merge" | "note";

const FILTERS: Array<{ value: CommitFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "merge", label: "Merges" },
  { value: "note", label: "Notes" },
];

/**
 * A commit can be the head of many branches (the root commit is the ancestor of
 * every empty run branch). Show a few of their names and fold the rest behind a
 * count, so one busy commit cannot spill a wall of chips over the whole list.
 */
const MAX_BRANCH_CHIPS = 3;

const KIND_ICON: Record<Commit["kind"], IconType> = {
  root: LuCircleDot,
  normal: LuCircle,
  merge: LuGitMerge,
  note: LuPencilLine,
};

const VIEW_OPTIONS = [
  { value: "list" as const, label: "List" },
  { value: "graph" as const, label: "Graph" },
  { value: "git" as const, label: "Git" },
  { value: "activity" as const, label: "Activity" },
];

function relativeTime(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Copy for the commit-activity contribution graph. */
const activityCaption = (total: number) =>
  `${total} commit${total === 1 ? "" : "s"} in the last year`;
const activityAria = (total: number) =>
  `Commit activity over the last year: ${total} commit${total === 1 ? "" : "s"}`;
const describeCommitDay = (day: ActivityDay, date: Date) =>
  `${day.count} commit${day.count === 1 ? "" : "s"} on ${date.toLocaleDateString()}`;

/** History over the real commit DAG. */
export default function GitView({
  branches,
  commits,
  allCommits,
  branch,
  selectedId,
  onSelect,
  filter,
  onFilter,
  tags,
  loading,
  onRefresh,
  onOpenStorage,
  projectName,
  sessionCount,
}: {
  branches: Branch[];
  commits: Commit[];
  /** Every commit in the repo — the graph draws the whole DAG, not one branch. */
  allCommits: Commit[];
  branch: string;
  selectedId: string | null;
  onSelect: (commit: Commit) => void;
  filter: CommitFilter;
  onFilter: (filter: CommitFilter) => void;
  tags: RepoSnapshot["tags"];
  loading: boolean;
  onRefresh: () => void;
  onOpenStorage: () => void;
  projectName: string;
  sessionCount: number;
}) {
  const [view, setView] = useState<"list" | "graph" | "git" | "activity">("list");

  const branchesAt = (commitId: string) =>
    branches.filter((branch) => branch.head_commit_id === commitId).map((branch) => branch.name);

  const visible = filter === "all" ? commits : commits.filter((commit) => commit.kind === filter);

  const activityDays = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const commit of allCommits) {
      const key = commit.created_at.slice(0, 10);
      byDate.set(key, (byDate.get(key) ?? 0) + 1);
    }
    return [...byDate].map(([date, count]) => ({ date, count }));
  }, [allCommits]);

  return (
    <>
      <div className="cg-view-toolbar">
        <h1>History</h1>
        <Chip>{projectName}</Chip>
        {branch && <Chip>{branch}</Chip>}
        <span className="cg-view-sub">
          {sessionCount} session{sessionCount === 1 ? "" : "s"} · {visible.length} commit{visible.length === 1 ? "" : "s"}
        </span>
        {tags.length > 0 && <Chip>{tags.length} tag{tags.length === 1 ? "" : "s"}</Chip>}
        <span className="cg-toolbar-spacer" />
        <div className="cg-tags" role="group" aria-label="Commit kind filter">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              className="cg-chip"
              aria-pressed={filter === option.value}
              data-tone={filter === option.value ? "signal" : undefined}
              onClick={() => onFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button type="button" className="cg-btn cg-btn-sm" onClick={onRefresh}>
          Refresh
        </button>
        <button type="button" className="cg-btn cg-btn-sm" onClick={onOpenStorage}>
          Storage
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
                      aria-label={`Open AI conversation for ${commit.summary ?? commit.id.slice(0, 7)}`}
                      title="Open AI conversation"
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
                          {labels.slice(0, MAX_BRANCH_CHIPS).map((name) => (
                            <Chip key={name}>{name}</Chip>
                          ))}
                          {labels.length > MAX_BRANCH_CHIPS && (
                            <span
                              className="cg-chip cg-chip-more"
                              title={labels.join(", ")}
                            >
                              +{labels.length - MAX_BRANCH_CHIPS} more
                            </span>
                          )}
                        </span>
                      </span>
                      <span
                        className="cg-commit-time"
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
        ) : view === "graph" ? (
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
        ) : view === "git" ? (
          <div className="cg-lane-wrap">
            <Suspense
              fallback={
                <div className="cg-graph-placeholder">
                  <strong>Loading graph…</strong>
                </div>
              }
            >
              <LaneGraph
                commits={allCommits}
                branches={branches}
                focusBranch={branch}
                selectedId={selectedId}
                onSelect={(id) => {
                  const commit = allCommits.find((entry) => entry.id === id);
                  if (commit) onSelect(commit);
                }}
              />
            </Suspense>
          </div>
        ) : (
          <ActivityHeatmap
            days={activityDays}
            caption={activityCaption}
            ariaLabel={activityAria}
            describe={describeCommitDay}
          />
        )}
      </div>
    </>
  );
}
