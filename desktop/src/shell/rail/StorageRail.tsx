import type { Branch, Session } from "@/lib/api";
import type { ClosedPane } from "../storage/recentlyClosed";

/** Which kind of recoverable item the Storage view shows. */
export type StorageCategory = "all" | "runs" | "conversations" | "branches" | "closed";

const CATEGORIES: Array<{ value: StorageCategory; label: string }> = [
  { value: "all", label: "Everything" },
  { value: "runs", label: "Runs" },
  { value: "conversations", label: "Conversations" },
  { value: "branches", label: "Branches" },
  { value: "closed", label: "Recently closed" },
];

/**
 * Storage rail: category filters and a search box over the trashed runs,
 * conversations and branches, plus the panes closed this session.
 */
export default function StorageRail({
  sessions,
  branches,
  closed,
  category,
  onCategory,
  query,
  onQuery,
}: {
  sessions: Session[];
  branches: Branch[];
  closed: ClosedPane[];
  category: StorageCategory;
  onCategory: (category: StorageCategory) => void;
  query: string;
  onQuery: (query: string) => void;
}) {
  const runs = sessions.filter((session) => session.kind === "terminal").length;
  const conversations = sessions.filter((session) => session.kind === "chat").length;
  const counts: Record<StorageCategory, number> = {
    all: sessions.length + branches.length + closed.length,
    runs,
    conversations,
    branches: branches.length,
    closed: closed.length,
  };

  return (
    <nav className="cg-rail" aria-label="Storage">
      <div className="cg-rail-head">
        <h2>Storage</h2>
        <span className="cg-count">{counts.all}</span>
      </div>
      <div className="cg-rail-search">
        <input
          type="search"
          placeholder="Search Storage"
          aria-label="Search Storage"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
      </div>
      {CATEGORIES.map((entry) => (
        <button
          key={entry.value}
          type="button"
          className="cg-row"
          aria-current={category === entry.value}
          onClick={() => onCategory(entry.value)}
        >
          <span className="cg-row-title">{entry.label}</span>
          <span className="cg-toolbar-spacer" />
          <span className="cg-commit-hash">{counts[entry.value]}</span>
        </button>
      ))}
    </nav>
  );
}
