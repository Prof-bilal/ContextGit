import { useEffect, useMemo, useState } from "react";
import { api, type Session } from "@/lib/api";
import BranchDialog from "../git/BranchDialog";
import { commitsOnBranch } from "../git/branchCommits";
import DiffSheet from "../git/DiffSheet";
import DeleteBranchDialog from "../git/DeleteBranchDialog";
import MergeDialog from "../git/MergeDialog";
import CommitConversationDialog from "../git/CommitConversationDialog";
import StorageFeature from "./StorageFeature";
import { Chip, Field } from "../primitives";
import GitRail from "../rail/GitRail";
import GitView, { type CommitFilter } from "../views/GitView";
import SessionDetailView from "../views/SessionDetailView";
import ProjectMemoryDialog from "../views/ProjectMemoryDialog";
import { useWorkbench } from "../WorkbenchContext";
import { FeaturePorts } from "../FeaturePorts";


export default function GitFeature() {
  const { snapshot, refreshRepo, repoLoading, refreshTrash, repoError, sessions, projects, activePath, refresh: refreshSessions, model } = useWorkbench();
  const branches = snapshot?.branches ?? [];
  const commits = [...(snapshot?.commits ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));

  const [barError, setBarError] = useState<string | null>(null);

  const [commitId, setCommitId] = useState<string | null>(null);

  const [selectedBranch, setSelectedBranch] = useState("");

  const [selectedProject, setSelectedProject] = useState(activePath ?? "");

  const [filter, setFilter] = useState<CommitFilter>("all");

  const [diffOpen, setDiffOpen] = useState(false);

  const [branchOpen, setBranchOpen] = useState(false);

  const [branchToDelete, setBranchToDelete] = useState<string | null>(null);

  const [mergeOpen, setMergeOpen] = useState(false);

  const [surface, setSurface] = useState<"history" | "storage" | "session">("history");
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryPreview, setMemoryPreview] = useState<import("@/lib/api").ProjectMemoryRevision | null>(null);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [conversationOpen, setConversationOpen] = useState(false);

  const projectSessions = useMemo(
    () => sessions.filter((session) => (selectedProject ? session.project_path === selectedProject : true)),
    [sessions, selectedProject],
  );
  const projectSessionBranches = useMemo(() => new Set(projectSessions.map((session) => session.branch)), [projectSessions]);
  const projectBranches = selectedProject
    ? branches.filter((branch) => branch.project_path === selectedProject || projectSessionBranches.has(branch.name))
    : branches;
  const projectCommitIds = useMemo(() => {
    if (!selectedProject) return null;
    const ids = new Set<string>();
    for (const branch of projectBranches) {
      const head = branch.head_commit_id;
      if (head) for (const commit of commitsOnBranch(commits, head)) ids.add(commit.id);
    }
    return ids;
  }, [commits, projectBranches, selectedProject]);
  const scopedCommits = projectCommitIds ? commits.filter((commit) => projectCommitIds.has(commit.id)) : commits;

  const branchHead =
    branches.find((branch) => branch.name === selectedBranch)?.head_commit_id ?? null;

  const branchCommits = branchHead ? commitsOnBranch(commits, branchHead) : scopedCommits;

  const activeCommit = scopedCommits.find((commit) => commit.id === commitId) ?? branchCommits[0] ?? null;

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
    if (selectedProject && !projectSessions.some((session) => session.project_path === selectedProject) && !projects.some((project) => project.path === selectedProject)) {
      setSelectedProject(activePath ?? "");
    }
  }, [activePath, projectSessions, projects, selectedProject]);

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

  const chooseProject = (path: string) => {
    setSelectedProject(path);
    setSelectedBranch("");
    setCommitId(null);
  };

  const chooseSession = (session: Session) => {
    setSelectedProject(session.project_path ?? "");
    chooseBranch(session.branch);
    setSelectedSession(session);
    setSurface("session");
  };

  const selectCommit = (commit: import("@/lib/api").Commit) => {
    setCommitId(commit.id);
    setConversationOpen(true);
  };

  const deleteSession = async (session: Session) => {
    if (!window.confirm(`Delete session "${session.name}" and its private commits?`)) return;
    try {
      await api.deleteSession(session.id, true);
      if (selectedBranch === session.branch) {
        setSelectedBranch("");
        setCommitId(null);
      }
      setBarError(null);
      await Promise.all([refreshSessions(), refreshRepo(), refreshTrash()]);
    } catch (cause) {
      setBarError(cause instanceof Error ? cause.message : "Could not delete session");
    }
  };

  const projectLabel = selectedProject
    ? projects.find((project) => project.path === selectedProject)?.name
      ?? selectedProject.split(/[\\/]/).filter(Boolean).at(-1)
      ?? selectedProject
    : "All projects";

  const synthesizeMemory = async () => {
    if (!selectedProject) return;
    setMemoryOpen(true);
    setMemoryPreview(null);
    setMemoryError(null);
    setMemoryBusy(true);
    try {
      const preview = await api.synthesizeProjectMemory({
        projectPath: selectedProject,
        sessionIds: projectSessions.map((session) => session.id),
        provider: model.providerId || undefined,
        model: model.modelId || undefined,
      });
      setMemoryPreview(preview);
    } catch (cause) {
      setMemoryError(cause instanceof Error ? cause.message : "Could not synthesize project knowledge");
    } finally {
      setMemoryBusy(false);
    }
  };

  const approveMemory = async () => {
    if (!memoryPreview) return;
    setMemoryBusy(true);
    setMemoryError(null);
    try {
      await api.approveProjectMemory(memoryPreview.id, memoryPreview);
      setMemoryOpen(false);
      setMemoryPreview(null);
    } catch (cause) {
      setMemoryError(cause instanceof Error ? cause.message : "Could not approve project knowledge");
    } finally {
      setMemoryBusy(false);
    }
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

  if (surface === "storage") {
    return <StorageFeature onClose={() => setSurface("history")} />;
  }

  const rail = () => {
    return (
      <GitRail
        projects={projects}
        sessions={sessions}
        branches={branches}
        commits={commits}
        currentBranch={snapshot?.current_branch ?? ""}
        selectedProject={selectedProject}
        selectedBranch={selectedBranch}
        onSelectProject={chooseProject}
        onSelectSession={chooseSession}
        onDeleteSession={(session) => void deleteSession(session)}
        onCheckout={(name) => void checkoutBranch(name)}
        onDelete={(name) => setBranchToDelete(name)}
      />
    );
  };

  const view = () => {
    if (surface === "session" && selectedSession) {
      return <SessionDetailView session={selectedSession} onBack={() => setSurface("history")} onRefresh={() => { void refreshSessions(); void refreshRepo(); }} />;
    }
    return (
      <GitView
        branches={projectBranches}
        commits={branchCommits}
        allCommits={scopedCommits}
        branch={selectedBranch}
        selectedId={activeCommit?.id ?? null}
        onSelect={selectCommit}
        filter={filter}
        onFilter={setFilter}
        tags={snapshot?.tags ?? []}
        loading={repoLoading}
        onRefresh={() => void refreshRepo()}
        onOpenStorage={() => setSurface("storage")}
        projectName={projectLabel}
        sessionCount={projectSessions.length}
        onSynthesize={selectedProject && projectSessions.length > 0 ? () => void synthesizeMemory() : undefined}
      />
    );
  };

  const dock = () => {
    if (surface === "session") return <p className="cg-empty-note">Session details are open in the main workspace.</p>;
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
    )}
    {memoryOpen && <ProjectMemoryDialog projectName={projectLabel} memory={memoryPreview} busy={memoryBusy} error={memoryError} onApprove={() => void approveMemory()} onClose={() => { if (!memoryBusy) setMemoryOpen(false); }} />}
    {conversationOpen && activeCommit && <CommitConversationDialog commit={activeCommit} onClose={() => setConversationOpen(false)} />}
  </>;
  return <FeaturePorts id="git"
    title={"Commit"}
    rail={rail}
    view={view}
    dock={dock}
    footer={footer}
    dialogs={dialogs}
    onDismissDialogs={() => { setDiffOpen(false); setBranchOpen(false); setBranchToDelete(null); setMergeOpen(false); setMemoryOpen(false); setConversationOpen(false); }}
    hasModal={diffOpen || branchOpen || branchToDelete !== null || mergeOpen || memoryOpen || conversationOpen}
    notice={barError ?? repoError} />;
}
