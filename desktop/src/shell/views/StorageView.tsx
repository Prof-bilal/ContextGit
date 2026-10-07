import { LuRotateCcw, LuUndo2, LuX } from "react-icons/lu";

import type { Branch, Session } from "@/lib/api";
import { Chip } from "../primitives";
import type { StorageCategory } from "../rail/StorageRail";
import type { ClosedPane } from "../storage/recentlyClosed";

/** The key that identifies a selectable Storage row in the Shell. */
export function sessionKey(id: string): string {
  return `session:${id}`;
}
export function branchKey(name: string): string {
  return `branch:${name}`;
}
export function closedKey(id: string): string {
  return `closed:${id}`;
}

type Row =
  | { key: string; kind: "run" | "conversation"; session: Session }
  | { key: string; kind: "branch"; branch: Branch }
  | { key: string; kind: "closed"; pane: ClosedPane };

const KIND_LABEL: Record<Row["kind"], string> = {
  run: "Run",
  conversation: "Conversation",
  branch: "Branch",
  closed: "Closed pane",
};

function relativeTime(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Storage: trashed runs and conversations, trashed branches, and the panes
 * closed this session — each recoverable in one click.
 */
export default function StorageView({
  sessions,
  branches,
  closed,
  category,
  query,
  selectedKey,
  onSelect,
  onRestoreSession,
  onRestoreBranch,
  onPurgeSession,
  onPurgeBranch,
  onReopen,
  onClearClosed,
}: {
  sessions: Session[];
  branches: Branch[];
  closed: ClosedPane[];
  category: StorageCategory;
  query: string;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onRestoreSession: (session: Session) => void;
  onRestoreBranch: (branch: Branch) => void;
  onPurgeSession: (session: Session) => void;
  onPurgeBranch: (branch: Branch) => void;
  onReopen: (pane: ClosedPane) => void;
  onClearClosed: () => void;
}) {
  const rows: Row[] = [];
  if (category === "all" || category === "runs" || category === "conversations") {
    for (const session of sessions) {
      const kind = session.kind === "chat" ? "conversation" : "run";
      if (category === "runs" && kind !== "run") continue;
      if (category === "conversations" && kind !== "conversation") continue;
      rows.push({ key: sessionKey(session.id), kind, session });
    }
  }
  if (category === "all" || category === "branches") {
    for (const branch of branches) rows.push({ key: branchKey(branch.name), kind: "branch", branch });
  }
  if (category === "all" || category === "closed") {
    for (const pane of closed) rows.push({ key: closedKey(pane.id), kind: "closed", pane });
  }

  const needle = query.trim().toLowerCase();
  const title = (row: Row) =>
    row.kind === "branch" ? row.branch.name : row.kind === "closed" ? row.pane.name : row.session.name;
  const visible = needle ? rows.filter((row) => title(row).toLowerCase().includes(needle)) : rows;

  return (
    <>
      <div className="cg-view-toolbar">
        <h1>Storage</h1>
        <span className="cg-view-sub">
          {visible.length} item{visible.length === 1 ? "" : "s"}
        </span>
        <span className="cg-toolbar-spacer" />
        {category === "closed" && closed.length > 0 && (
          <button type="button" className="cg-btn cg-btn-sm" onClick={onClearClosed}>
            Clear history
          </button>
        )}
      </div>
      <div className="cg-view-body">
        {visible.length === 0 ? (
          <div className="cg-doc">
            <p className="cg-empty-note">
              Nothing here. Deleting a run, conversation or branch moves it to Storage, and panes
              you close show up under Recently closed.
            </p>
          </div>
        ) : (
          <div className="cg-doc">
            <ol className="cg-commit-list" aria-label="Storage items">
              {visible.map((row) => {
                const at =
                  row.kind === "branch"
                    ? (row.branch.deleted_at ?? "")
                    : row.kind === "closed"
                      ? row.pane.at
                      : (row.session.deleted_at ?? row.session.updated_at);
                const subtitle =
                  row.kind === "branch"
                    ? `${row.branch.head_commit_id.slice(0, 7)} · commits kept`
                    : row.kind === "closed"
                      ? "Reopen in the Code tab"
                      : row.session.branch;
                return (
                  <li key={row.key}>
                    <div className="cg-row-wrap">
                      <button
                        type="button"
                        className="cg-row cg-row-top"
                        aria-current={selectedKey === row.key}
                        onClick={() => onSelect(row.key)}
                      >
                        <span className="cg-row-copy">
                          <span className="cg-row-title">{title(row)}</span>
                          <span className="cg-row-meta">
                            <Chip>{KIND_LABEL[row.kind]}</Chip>
                            <span className="cg-mono">{subtitle}</span>
                            {at && (
                              <>
                                <span>·</span>
                                <span title={new Date(at).toLocaleString()}>
                                  {relativeTime(at)}
                                </span>
                              </>
                            )}
                          </span>
                        </span>
                      </button>
                      {row.kind === "closed" ? (
                        <button
                          type="button"
                          className="cg-icon-btn cg-row-switch"
                          aria-label={`Reopen ${row.pane.name}`}
                          title="Reopen this pane"
                          onClick={() => onReopen(row.pane)}
                        >
                          <LuUndo2 aria-hidden="true" />
                        </button>
                      ) : row.kind === "branch" ? (
                        <>
                          <button
                            type="button"
                            className="cg-icon-btn cg-row-switch"
                            aria-label={`Restore branch ${row.branch.name}`}
                            title="Restore from Storage"
                            onClick={() => onRestoreBranch(row.branch)}
                          >
                            <LuRotateCcw aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="cg-icon-btn cg-row-delete"
                            aria-label={`Delete branch ${row.branch.name} forever`}
                            title="Delete forever"
                            onClick={() => onPurgeBranch(row.branch)}
                          >
                            <LuX aria-hidden="true" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="cg-icon-btn cg-row-switch"
                            aria-label={`Restore ${row.session.name}`}
                            title="Restore from Storage"
                            onClick={() => onRestoreSession(row.session)}
                          >
                            <LuRotateCcw aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="cg-icon-btn cg-row-delete"
                            aria-label={`Delete ${row.session.name} forever`}
                            title="Delete forever"
                            onClick={() => onPurgeSession(row.session)}
                          >
                            <LuX aria-hidden="true" />
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>
    </>
  );
}
