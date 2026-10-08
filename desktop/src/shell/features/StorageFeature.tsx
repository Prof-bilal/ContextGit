import { useCallback, useState } from "react";
import { api, type Session } from "@/lib/api";
import { Field } from "../primitives";
import StorageRail, { type StorageCategory } from "../rail/StorageRail";
import StorageView, { branchKey, closedKey, sessionKey } from "../views/StorageView";
import ConfirmDialog from "../storage/ConfirmDialog";
import { clearClosed, removeClosed, type ClosedPane } from "../storage/recentlyClosed";
import { useWorkbench } from "../WorkbenchContext";
import { FeaturePorts } from "../FeaturePorts";


export default function StorageFeature() {
  const { setClosedPanes, sessions, openSession, refresh, refreshTrash, refreshRepo, trashSessions, trashBranches, closedPanes, trashError } = useWorkbench();
  const [barError, setBarError] = useState<string | null>(null);

  const [trashCategory, setTrashCategory] = useState<StorageCategory>("all");

  const [trashQuery, setTrashQuery] = useState("");

  const [trashSelected, setTrashSelected] = useState<string | null>(null);

  const [purgeTarget, setPurgeTarget] = useState<{
    kind: "session" | "branch";
    key: string;
    label: string;
  } | null>(null);

  const [emptyTrashOpen, setEmptyTrashOpen] = useState(false);

  const reopenClosed = useCallback(
    (pane: ClosedPane) => {
      setClosedPanes(removeClosed(pane.id));
      const session = sessions.find((entry) => entry.id === pane.id);
      if (session) openSession(session);
      else setBarError("That run no longer exists — it may have been deleted.");
    },
    [openSession, sessions],
  );

  const restoreTrashedSession = useCallback(
    async (session: Session) => {
      try {
        await api.restoreSession(session.id);
        setBarError(null);
        await Promise.all([refresh(), refreshTrash()]);
      } catch (cause) {
        setBarError(cause instanceof Error ? cause.message : "Could not restore run");
      }
    },
    [refresh, refreshTrash],
  );

  const restoreTrashedBranch = useCallback(
    async (branch: { name: string }) => {
      try {
        await api.restoreBranch(branch.name);
        setBarError(null);
        await Promise.all([refreshRepo(), refreshTrash()]);
      } catch (cause) {
        setBarError(cause instanceof Error ? cause.message : "Could not restore branch");
      }
    },
    [refreshRepo, refreshTrash],
  );

  const purgeSelected = useCallback(async () => {
    if (!purgeTarget) return;
    if (purgeTarget.kind === "session") await api.deleteSession(purgeTarget.key, true);
    else await api.deleteBranch(purgeTarget.key, true);
    setTrashSelected(null);
    await Promise.all([refresh(), refreshRepo(), refreshTrash()]);
  }, [purgeTarget, refresh, refreshRepo, refreshTrash]);

  const emptyTrash = useCallback(async () => {
    await Promise.all([
      ...trashSessions.map((session) => api.deleteSession(session.id, true)),
      ...trashBranches.map((branch) => api.deleteBranch(branch.name, true)),
    ]);
    setTrashSelected(null);
    await Promise.all([refresh(), refreshRepo(), refreshTrash()]);
  }, [trashSessions, trashBranches, refresh, refreshRepo, refreshTrash]);
  const rail = () => {
    return (
      <StorageRail
        sessions={trashSessions}
        branches={trashBranches}
        closed={closedPanes}
        category={trashCategory}
        onCategory={setTrashCategory}
        query={trashQuery}
        onQuery={setTrashQuery}
      />
    );
  };

  const view = () => {
    return (
      <StorageView
        sessions={trashSessions}
        branches={trashBranches}
        closed={closedPanes}
        category={trashCategory}
        query={trashQuery}
        selectedKey={trashSelected}
        onSelect={setTrashSelected}
        onRestoreSession={(session) => void restoreTrashedSession(session)}
        onRestoreBranch={(branch) => void restoreTrashedBranch(branch)}
        onPurgeSession={(session) =>
          setPurgeTarget({ kind: "session", key: session.id, label: session.name })
        }
        onPurgeBranch={(branch) =>
          setPurgeTarget({ kind: "branch", key: branch.name, label: branch.name })
        }
        onReopen={reopenClosed}
        onClearClosed={() => setClosedPanes(clearClosed())}
      />
    );
  };

  const dock = () => {
    {
      const selected = trashSelected;
      const session = selected?.startsWith("session:")
        ? trashSessions.find((entry) => sessionKey(entry.id) === selected)
        : undefined;
      const branch = selected?.startsWith("branch:")
        ? trashBranches.find((entry) => branchKey(entry.name) === selected)
        : undefined;
      const pane = selected?.startsWith("closed:")
        ? closedPanes.find((entry) => closedKey(entry.id) === selected)
        : undefined;
      if (session) {
        return (
          <div className="cg-fields">
            <Field label="Type">{session.kind === "chat" ? "Conversation" : "Run"}</Field>
            <Field label="Branch">{session.branch}</Field>
            <Field label="Agent">{session.agent ?? "—"}</Field>
            <Field label="Project">{session.project_path ?? "—"}</Field>
            <Field label="Moved to Storage">
              {session.deleted_at ? new Date(session.deleted_at).toLocaleString() : "—"}
            </Field>
          </div>
        );
      }
      if (branch) {
        return (
          <div className="cg-fields">
            <Field label="Type">Branch</Field>
            <Field label="Head">
              <span className="cg-mono">{branch.head_commit_id.slice(0, 7)}</span>
            </Field>
            <Field label="Moved to Storage">
              {branch.deleted_at ? new Date(branch.deleted_at).toLocaleString() : "—"}
            </Field>
          </div>
        );
      }
      if (pane) {
        return (
          <div className="cg-fields">
            <Field label="Type">Closed pane</Field>
            <Field label="Run">{pane.name}</Field>
            <Field label="Closed">{new Date(pane.at).toLocaleString()}</Field>
          </div>
        );
      }
      return (
        <p className="cg-empty-note">
          Select an item to inspect it, then restore or delete it for good.
        </p>
      );
    }
  };

  const footer = () => {
    const selected = trashSelected;
    const session = selected?.startsWith("session:")
      ? trashSessions.find((entry) => sessionKey(entry.id) === selected)
      : undefined;
    const branch = selected?.startsWith("branch:")
      ? trashBranches.find((entry) => branchKey(entry.name) === selected)
      : undefined;
    const pane = selected?.startsWith("closed:")
      ? closedPanes.find((entry) => closedKey(entry.id) === selected)
      : undefined;
    return (
      <footer className="cg-bottombar" aria-label="Storage actions">
        <span className="cg-bb-info">
          <strong>{session?.name ?? branch?.name ?? pane?.name ?? "Storage"}</strong>
          <span className="cg-view-sub">
            {trashSessions.length + trashBranches.length} recoverable
            {closedPanes.length > 0 ? ` · ${closedPanes.length} closed` : ""}
          </span>
        </span>
        <span className="cg-bb-actions cg-bb-end">
          <button
            type="button"
            className="cg-btn"
            disabled={!session && !branch && !pane}
            onClick={() => {
              if (pane) reopenClosed(pane);
              else if (session) void restoreTrashedSession(session);
              else if (branch) void restoreTrashedBranch(branch);
            }}
          >
            {pane ? "Reopen" : "Restore"}
          </button>
          <button
            type="button"
            className="cg-btn"
            data-variant="danger"
            disabled={!session && !branch}
            onClick={() => {
              if (session) {
                setPurgeTarget({ kind: "session", key: session.id, label: session.name });
              } else if (branch) {
                setPurgeTarget({ kind: "branch", key: branch.name, label: branch.name });
              }
            }}
          >
            Delete forever
          </button>
          <button
            type="button"
            className="cg-btn"
            disabled={trashSessions.length === 0 && trashBranches.length === 0}
            onClick={() => setEmptyTrashOpen(true)}
          >
            Empty Storage
          </button>
        </span>
      </footer>
    );
  };

  const dialogs = () => <>{purgeTarget && (
    <ConfirmDialog
      title={purgeTarget.kind === "branch" ? "Delete branch forever" : "Delete forever"}
      subtitle={purgeTarget.label}
      body={
        purgeTarget.kind === "branch"
          ? `Permanently drop the "${purgeTarget.label}" branch pointer. Every commit stays in the repository.`
          : `Permanently delete "${purgeTarget.label}". Its worktree is removed when clean; its commits and branch stay in the repository.`
      }
      confirmLabel="Delete forever"
      onConfirm={purgeSelected}
      onClose={() => setPurgeTarget(null)}
    />
  )}
    {emptyTrashOpen && (
      <ConfirmDialog
        title="Empty Storage"
        body={`Permanently delete ${trashSessions.length} run(s) and ${trashBranches.length} branch pointer(s). Every commit is kept.`}
        confirmLabel="Empty Storage"
        onConfirm={emptyTrash}
        onClose={() => setEmptyTrashOpen(false)}
      />
    )}</>;
  return <FeaturePorts id="storage"
    title={"Storage"}
    rail={rail}
    view={view}
    dock={dock}
    footer={footer}
    dialogs={dialogs}
    onDismissDialogs={() => { setPurgeTarget(null); setEmptyTrashOpen(false); }}
    hasModal={purgeTarget !== null || emptyTrashOpen}
    notice={barError ?? trashError} />;
}
