import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import BranchDialog from "../git/BranchDialog";
import { commitsOnBranch } from "../git/branchCommits";
import DiffSheet from "../git/DiffSheet";
import DeleteBranchDialog from "../git/DeleteBranchDialog";
import MergeDialog from "../git/MergeDialog";
import { Chip, Field } from "../primitives";
import GitRail from "../rail/GitRail";
import GitView, { type CommitFilter } from "../views/GitView";
import { useWorkbench } from "../WorkbenchContext";
import { FeaturePorts } from "../FeaturePorts";


export default function GitFeature() {
  const { snapshot, refreshRepo, repoLoading, refreshTrash, repoError } = useWorkbench();
  const branches = snapshot?.branches ?? [];
  const commits = [...(snapshot?.commits ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));

  const [barError, setBarError] = useState<string | null>(null);

  const [commitId, setCommitId] = useState<string | null>(null);

  const [selectedBranch, setSelectedBranch] = useState("");

  const [filter, setFilter] = useState<CommitFilter>("all");

  const [diffOpen, setDiffOpen] = useState(false);

  const [branchOpen, setBranchOpen] = useState(false);

  const [branchToDelete, setBranchToDelete] = useState<string | null>(null);

  const [mergeOpen, setMergeOpen] = useState(false);

  const branchHead =
    branches.find((branch) => branch.name === selectedBranch)?.head_commit_id ?? null;

  const branchCommits = branchHead ? commitsOnBranch(commits, branchHead) : commits;

  const activeCommit = commits.find((commit) => commit.id === commitId) ?? branchCommits[0] ?? null;

  const activeCommitTags = (snapshot?.tags ?? []).filter((tag) => tag.commit_id === activeCommit?.id);

  useEffect(() => {
    if (!snapshot) return;
    setSelectedBranch((current) =>
      current && snapshot.branches.some((branch) => branch.name === current)
        ? current
        : snapshot.current_branch || snapshot.branches[0]?.name || "",
    );
  }, [snapshot]);

  useEffect(() => {
    if (!snapshot) return;
    const head =
      snapshot.branches.find((branch) => branch.name === selectedBranch)?.head_commit_id ?? null;
    setCommitId((current) =>
      current && snapshot.commits.some((commit) => commit.id === current) ? current : head,
    );
  }, [snapshot, selectedBranch]);

  const chooseBranch = (name: string) => {
    setSelectedBranch(name);
    const head = branches.find((branch) => branch.name === name)?.head_commit_id ?? null;
    if (head) setCommitId(head);
  };

  const checkoutBranch = async (name: string) => {
    try {
      await api.checkout(name);
      setBarError(null);
      chooseBranch(name);
      await refreshRepo();
    } catch (cause) {
      setBarError(cause instanceof Error ? cause.message : "Could not switch branch");
    }
  };
  const rail = () => {
    return (
      <GitRail
        branches={branches}
        commits={commits}
        currentBranch={snapshot?.current_branch ?? ""}
        selectedBranch={selectedBranch}
        onSelectBranch={chooseBranch}
        onCheckout={(name) => void checkoutBranch(name)}
        onDelete={(name) => setBranchToDelete(name)}
      />
    );
  };

  const view = () => {
    return (
      <GitView
        branches={branches}
        commits={branchCommits}
        allCommits={commits}
        branch={selectedBranch}
        selectedId={activeCommit?.id ?? null}
        onSelect={(commit) => setCommitId(commit.id)}
        filter={filter}
        onFilter={setFilter}
        tags={snapshot?.tags ?? []}
        loading={repoLoading}
        onRefresh={() => void refreshRepo()}
      />
    );
  };

  const dock = () => {
    return activeCommit ? (
      <>
        <div className="cg-fields">
          <Field label="Commit">
            <span className="cg-mono">{activeCommit.id.slice(0, 7)}</span>
          </Field>
          <Field label="Kind">
            <Chip>{activeCommit.kind}</Chip>
          </Field>
          <Field label="Summary">{activeCommit.summary ?? "—"}</Field>
          <Field label="Model">{activeCommit.model}</Field>
          <Field label="Author">{activeCommit.author ?? "—"}</Field>
          <Field label="Parents">
            {activeCommit.parent_ids.length > 0
              ? activeCommit.parent_ids.map((id) => id.slice(0, 7)).join(", ")
              : "root commit"}
          </Field>
          <Field label="Messages">{activeCommit.messages.length}</Field>
          <Field label="Tags">
            {activeCommitTags.length > 0
              ? activeCommitTags.map((tag) => tag.name).join(", ")
              : "—"}
          </Field>
        </div>
        <div className="cg-dock-actions">
          <button
            type="button"
            className="cg-btn"
            onClick={() => setBranchOpen(true)}
            aria-haspopup="dialog"
          >
            Branch from here
          </button>
          <button
            type="button"
            className="cg-btn"
            onClick={() => setDiffOpen(true)}
            aria-haspopup="dialog"
          >
            View diff
          </button>
        </div>
      </>
    ) : (
      <p className="cg-empty-note">Select a commit to inspect it.</p>
    );
  };

  const footer = () => {
    return (
      <footer className="cg-bottombar">
        <span className="cg-bb-info">
          <span className="cg-view-sub">
            {activeCommit
              ? `${activeCommit.id.slice(0, 7)} · ${activeCommit.kind} · ${activeCommit.messages.length} messages`
              : "No commit selected."}
          </span>
        </span>
        <span className="cg-bb-actions cg-bb-end">
          <button
            type="button"
            className="cg-btn"
            data-variant="primary"
            disabled={branches.length < 2}
            onClick={() => setMergeOpen(true)}
            aria-haspopup="dialog"
          >
            Review merge…
          </button>
        </span>
      </footer>
    );
  };

  const dialogs = () => <>{diffOpen && activeCommit && (
    <DiffSheet
      commit={activeCommit}
      parentId={activeCommit.parent_ids[0] ?? null}
      onClose={() => setDiffOpen(false)}
    />
  )}
    {branchOpen && activeCommit && (
      <BranchDialog
        commit={activeCommit}
        onCreated={() => void refreshRepo()}
        onClose={() => setBranchOpen(false)}
      />
    )}
    {branchToDelete && (
      <DeleteBranchDialog
        name={branchToDelete}
        onDeleted={() => {
          // If we deleted the branch we were viewing, fall back to the repo's.
          if (selectedBranch === branchToDelete) {
            chooseBranch(snapshot?.current_branch || branches[0]?.name || "");
          }
          void refreshRepo();
          void refreshTrash();
        }}
        onClose={() => setBranchToDelete(null)}
      />
    )}
    {mergeOpen && (
      <MergeDialog
        branches={branches}
        target={selectedBranch || snapshot?.current_branch || ""}
        onApplied={(commitId) => {
          setCommitId(commitId);
          void refreshRepo();
        }}
        onClose={() => setMergeOpen(false)}
      />
    )}</>;
  return <FeaturePorts id="git"
    title={"Commit"}
    rail={rail}
    view={view}
    dock={dock}
    footer={footer}
    dialogs={dialogs}
    onDismissDialogs={() => { setDiffOpen(false); setBranchOpen(false); setBranchToDelete(null); setMergeOpen(false); }}
    hasModal={diffOpen || branchOpen || branchToDelete !== null || mergeOpen}
    notice={barError ?? repoError} />;
}
