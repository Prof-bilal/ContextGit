import { useMemo, useState } from "react";
import { LuArrowRightLeft, LuX } from "react-icons/lu";

import type { Branch, Commit } from "@/lib/api";
import { commitsOnBranch } from "../git/branchCommits";
import { Chip } from "../primitives";

export type CommitFilter = "all" | "merge" | "note";

const FILTERS: Array<{ value: CommitFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "merge", label: "Merges" },
  { value: "note", label: "Notes" },
];

/**
 * Real branches. Every run creates one, and runs that never committed all sit on
 * the same root commit — so branches with no work of their own are counted and
 * folded away instead of flooding the list.
 */
export default function GitRail({
  branches,
  commits,
  currentBranch,
  selectedBranch,
  onSelectBranch,
  onCheckout,
  onDelete,
  filter,
  onFilter,
}: {
  branches: Branch[];
  commits: Commit[];
  currentBranch: string;
  selectedBranch: string;
  onSelectBranch: (branch: string) => void;
  onCheckout: (branch: string) => void;
  onDelete: (branch: string) => void;
  filter: CommitFilter;
  onFilter: (filter: CommitFilter) => void;
}) {
  const [query, setQuery] = useState("");
  const [showEmpty, setShowEmpty] = useState(false);

  const { active, empty, matchCount } = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = branches.filter((branch) => branch.name.toLowerCase().includes(needle));
    const activeBranches: Branch[] = [];
    const emptyBranches: Branch[] = [];

    for (const branch of matching) {
      // "No work" = only the root commit is reachable from the head.
      const count = commitsOnBranch(commits, branch.head_commit_id).length;
      if (count > 1 || branch.name === currentBranch || branch.name === selectedBranch) {
        activeBranches.push(branch);
      } else {
        emptyBranches.push(branch);
      }
    }

    const byCurrentThenName = (a: Branch, b: Branch) => {
      if (a.name === currentBranch) return -1;
      if (b.name === currentBranch) return 1;
      return a.name.localeCompare(b.name);
    };
    activeBranches.sort(byCurrentThenName);
    emptyBranches.sort(byCurrentThenName);

    return { active: activeBranches, empty: emptyBranches, matchCount: matching.length };
  }, [branches, commits, currentBranch, selectedBranch, query]);

  const row = (branch: Branch) => {
    const count = commitsOnBranch(commits, branch.head_commit_id).length;
    return (
      <div key={branch.name} className="cg-row-wrap">
        <button
          type="button"
          className="cg-row"
          title={`${branch.name} · ${branch.head_commit_id.slice(0, 7)}`}
          aria-current={branch.name === selectedBranch}
          onClick={() => onSelectBranch(branch.name)}
        >
          <span className="cg-row-title cg-branch-name">{branch.name}</span>
          <span className="cg-toolbar-spacer" />
          <span className="cg-commit-hash">{count > 1 ? `${count} commits` : "no commits"}</span>
          {branch.name === currentBranch && <Chip>current</Chip>}
        </button>
        {branch.name !== currentBranch && (
          <>
            <button
              type="button"
              className="cg-icon-btn cg-row-switch"
              aria-label={`Switch to branch ${branch.name}`}
              title="Switch to this branch (checkout)"
              onClick={() => onCheckout(branch.name)}
            >
              <LuArrowRightLeft aria-hidden="true" />
            </button>
            <button
              type="button"
              className="cg-icon-btn cg-row-delete"
              aria-label={`Delete branch ${branch.name}`}
              title="Delete branch (commits are kept)"
              onClick={() => onDelete(branch.name)}
            >
              <LuX aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    );
  };

  return (
    <nav className="cg-rail" aria-label="Branches">
      <div className="cg-rail-head">
        <h2>Branches</h2>
        <span className="cg-count">{branches.length}</span>
      </div>
      <div className="cg-rail-search">
        <input
          type="search"
          placeholder="Filter branches"
          aria-label="Filter branches"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="cg-rail-search">
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
      </div>

      {active.map(row)}

      {empty.length > 0 && (
        <button
          type="button"
          className="cg-new-btn"
          aria-expanded={showEmpty}
          onClick={() => setShowEmpty((shown) => !shown)}
        >
          {showEmpty ? "Hide" : "Show"} {empty.length} branch
          {empty.length === 1 ? "" : "es"} with no commits
        </button>
      )}
      {showEmpty && empty.map(row)}

      {active.length === 0 && empty.length === 0 && (
        <p className="cg-empty-note cg-rail-search">
          {matchCount === 0 && query ? "No branches match." : "No branches yet."}
        </p>
      )}
    </nav>
  );
}
