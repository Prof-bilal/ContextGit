"""Repo: the core library API (the contract in backend.md).

All business logic lives here. CLI and API call these methods and nothing
else touches storage. Commits are immutable; branches and HEAD are pointers.
Deleting a branch never deletes commits.
"""

import os
from collections.abc import Callable, Iterator
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Literal, cast
from uuid import uuid4

from contextgit.core import hashing
from contextgit.core.errors import (
    BranchNotFound,
    CommitNotFound,
    GateNotConfigured,
    InvalidMergeResolution,
    InvalidRefName,
    MergeConflict,
    RepoAlreadyExists,
    RepoNotFound,
    ScopeConflict,
    SessionNotFound,
    StagingEmpty,
    StaleMergePreview,
    TaskCycleError,
    TaskDependencyError,
    TaskNotReviewable,
    TeamNotFound,
    WorkInProgressLimit,
)
from contextgit.core.models import (
    AgentApproval,
    AgentArtifact,
    AgentRun,
    AgentStep,
    BlameEntry,
    Branch,
    Commit,
    CommitKind,
    EnvDrift,
    EnvEntry,
    HttpHistoryEntry,
    IssueFinding,
    IssueLink,
    IssueScanConfig,
    IssueScanRun,
    LocalIssue,
    MergeQueueEntry,
    Message,
    ProviderRecord,
    Session,
    Tag,
    Task,
    Team,
    TeamBoard,
    TeamEvent,
    TeamMessage,
    TeamMessageKind,
    UsageDay,
    UsageEvent,
    UsageRow,
    UsageSource,
    UsageStreak,
    UsageSummary,
    UsageSurface,
    UsageTotals,
    utcnow,
)
from contextgit.core.team import (
    STATUS_ORDER,
    TEAM_MESSAGE_KINDS,
    blocked_by,
    dependents,
    topological_order,
    validate_graph,
)
from contextgit.gitops import (
    DirtyWorktree,
    GitCommandError,
    NotAGitRepo,
    WorktreeManager,
    WorktreeNotFound,
)
from contextgit.gitops.context import context_document, write_context_block
from contextgit.gitops.globs import any_overlap
from contextgit.gitops.integrate import IntegrationConflict, integrate
from contextgit.gitops.repo import Git
from contextgit.gitops.status import FleetEntry, WorkspaceStatus, workspace_status
from contextgit.gitops.team import team_document, write_team_board
from contextgit.integration.service import IntegrationService
from contextgit.llm.base import LLMProvider
from contextgit.mcp.config import ensure_mcp_config
from contextgit.merge.engine import common_ancestor, messages_since
from contextgit.merge.engine import diff as build_diff
from contextgit.merge.models import CrossRunConflict, Diff, MergePreview, PairedMerge
from contextgit.merge.semantic import extract_semantics
from contextgit.storage.sqlite import SqliteStorage
from contextgit.verify import detect_gate, run_command
from contextgit.verify.env import capture_env, diff_env

_DB_NAME = "contextgit.db"
_ROOT_PARENT = "a3f9c21"
# How many runs a team may have in flight at once unless overridden.
_DEFAULT_MAX_ACTIVE = 5
# Port the first run gets; each further run takes the next one.
_DEFAULT_PORT_BASE = 4000
# Verifier preference when the caller does not name one (never the implementer).
_VERIFIER_AGENTS = (
    "claude",
    "codex",
    "gemini",
    "opencode",
    "aider",
    "freebuff",
    "cline",
    "pi",
    "kilo",
    "commandcode",
)


def _streak_from_dates(dates: set[date], today: date) -> UsageStreak:
    """Consecutive-day activity over a set of active dates (pure, for tests).

    `longest` is the longest run anywhere in the history; `current` walks back
    from today (or yesterday, so a streak is not reported broken before the
    day's first call). `today` is injected so the math is deterministic.
    """
    if not dates:
        return UsageStreak()
    ordered = sorted(dates)
    longest = run = 1
    for previous_day, day in zip(ordered, ordered[1:], strict=False):
        run = run + 1 if (day - previous_day).days == 1 else 1
        longest = max(longest, run)
    anchor = today if today in dates else today - timedelta(days=1)
    current = 0
    probe = anchor
    while probe in dates:
        current += 1
        probe -= timedelta(days=1)
    return UsageStreak(
        current=current,
        longest=longest,
        active_days=len(dates),
        last_active=ordered[-1].isoformat(),
    )


def _project_from_worktree(worktree_path: str) -> str | None:
    """The project folder a run's worktree lives under.

    Worktrees are laid out as `<project>/.contextgit/worktrees/<name>`, so the
    project is two directories up. None when the path is not that shape.
    """
    parents = Path(worktree_path).parents
    if len(parents) >= 3 and parents[0].name == "worktrees" and parents[1].name == ".contextgit":
        return str(parents[2])
    return None


class Repo:
    """A ContextGit repository rooted at a directory."""

    def __init__(self, root: Path | str, storage: SqliteStorage | None = None) -> None:
        self._root = Path(root)
        self._storage = storage or SqliteStorage(self._root / _DB_NAME)
        # One-time: fill in project_path for runs recorded before the column.
        self._projects_backfilled = False
        self._integration = IntegrationService(self)

    @property
    def integration(self) -> IntegrationService:
        """One integration coordinator per repository instance."""
        return self._integration

    def _queue_completed_task(self, task: Task) -> Task:
        if task.status == "review" and task.session_id:
            session = self.get_session(task.session_id)
            if (
                session.project_path
                and session.git_branch
                and self.integration.settings(session.project_path)["authority"] == "enabled"
            ):
                try:
                    job = self.integration.ready(task.session_id, task.id)
                    if job["state"] == "succeeded":
                        self.integration.finish_task(job)
                except ValueError as error:
                    self.post_message(
                        task.team_id,
                        f"Integration readiness blocked: {error}",
                        kind="review",
                        task_id=task.id,
                    )
        return task

    @property
    def root(self) -> Path:
        return self._root

    @classmethod
    def init(cls, path: Path | str, author: str | None = None) -> "Repo":
        """Create a new repository with a root commit on branch `main`."""
        root = Path(path)
        db = root / _DB_NAME
        root.mkdir(parents=True, exist_ok=True)
        storage = SqliteStorage(db)
        if storage.is_initialized():
            storage.close()
            raise RepoAlreadyExists(f"repository already exists at {root}")
        # A database with tables but no HEAD is a half-written repo (an
        # interrupted first request); initialize it rather than refuse.
        repo = cls(root, storage)
        root_commit = Commit(
            id=hashing.commit_id(parent_ids=[], messages=[], kind="root", model="none"),
            parent_ids=[],
            messages=[],
            kind="root",
            model="none",
            summary="root commit",
            author=author,
        )
        storage.insert_commit(root_commit)
        storage.insert_branch(Branch(name="main", head_commit_id=root_commit.id))
        storage.set_current_branch("main")
        return repo

    @classmethod
    def open(cls, path: Path | str) -> "Repo":
        """Open an existing repository; raises RepoNotFound if there is none."""
        db = Path(path) / _DB_NAME
        if not db.exists():
            raise RepoNotFound(f"no ContextGit repository at {Path(path)}")
        storage = SqliteStorage(db)
        if not storage.is_initialized():
            # Half-written repo (an interrupted init): treat as missing so the
            # caller re-initializes instead of serving an empty repository.
            storage.close()
            raise RepoNotFound(f"repository at {Path(path)} is not initialized")
        return cls(Path(path), storage)

    # ---------- commits ----------

    def commit(
        self,
        messages: list[Message],
        *,
        model: str,
        summary: str | None = None,
        author: str | None = None,
        kind: str = "normal",
        branch: str | None = None,
    ) -> Commit:
        """Append a commit with `messages` on the current (or named) branch."""
        name = branch or self._storage.get_current_branch()
        for _attempt in range(16):
            head_id = self._storage.get_branch(name).head_commit_id
            cid = hashing.commit_id(
                parent_ids=[head_id],
                messages=[(m.role, m.content) for m in messages],
                kind=kind,
                model=model,
            )
            commit = Commit(
                id=cid,
                parent_ids=[head_id],
                messages=messages,
                kind=cast("CommitKind", kind),
                model=model,
                summary=summary,
                author=author,
                token_count=sum(self._estimate_text(message.content) for message in messages),
            )
            try:
                self._storage.append_commit(name, commit, expected_head_id=head_id)
            except StaleMergePreview:
                # Another writer advanced this branch between the read and CAS.
                # Re-parent the immutable commit and try again; readers never
                # observe a partially updated branch pointer.
                continue
            return commit
        raise StaleMergePreview(f"branch '{name}' stayed busy while it was being updated")

    def log(self, branch: str | None = None) -> list[Commit]:
        """Commits reachable from the branch head, newest first."""
        head = self._storage.get_branch(branch or self._storage.get_current_branch())
        return list(self._walk(head.head_commit_id))

    def get_commit(self, commit_id: str) -> Commit:
        """Return one immutable commit by id."""
        return self._storage.get_commit(commit_id)

    def all_commits(self) -> list[Commit]:
        """Return every stored commit, including commits no branch currently names."""
        return [self._storage.get_commit(commit_id) for commit_id in self._storage.all_commit_ids()]

    def _walk(self, commit_id: str) -> Iterator[Commit]:
        """Walk parents from a commit (first parent for merges), newest first."""
        seen: set[str] = set()
        current: str | None = commit_id
        while current is not None and current not in seen:
            seen.add(current)
            commit = self._storage.get_commit(current)
            yield commit
            current = commit.parent_ids[0] if commit.parent_ids else None

    def build_context(self, commit_id: str) -> list[Message]:
        """Reconstruct the full context at a commit by walking parents.

        Root-first ordering: the messages of the oldest ancestor come first.
        """
        chain = list(self._walk(commit_id))
        chain.reverse()  # oldest first
        messages: list[Message] = []
        for commit in chain:
            messages.extend(commit.messages)
        return messages

    def blame(self, branch: str | None = None) -> list[BlameEntry]:
        """Provenance for every context message on a branch, in context order."""
        head = self._storage.get_branch(branch or self._storage.get_current_branch())
        chain = list(self._walk(head.head_commit_id))
        chain.reverse()  # oldest first, same order as build_context
        entries: list[BlameEntry] = []
        for commit in chain:
            for message in commit.messages:
                entries.append(
                    BlameEntry(
                        index=len(entries),
                        role=message.role,
                        content=message.content,
                        commit_id=commit.id,
                        kind=commit.kind,
                        model=commit.model,
                        summary=commit.summary,
                        author=commit.author,
                        created_at=commit.created_at,
                    )
                )
        return entries

    def branch_metrics(self, branch: str | None = None) -> dict[str, object]:
        """Real context size for the governor: head, token estimate, message count."""
        head = self._storage.get_branch(branch or self._storage.get_current_branch())
        return {
            "head": head.head_commit_id,
            "used": self.count_tokens(head.head_commit_id, ""),
            "messages": len(self.build_context(head.head_commit_id)),
        }

    # ---------- diff and merge ----------

    def _resolve_commit_ref(self, ref: str) -> str:
        """Resolve a branch name or commit id to a commit id."""
        if self._branch_exists(ref):
            return self._storage.get_branch(ref).head_commit_id
        if self._storage.has_commit(ref):
            return ref
        raise CommitNotFound(f"branch or commit '{ref[:12]}' not found")

    def common_ancestor(self, a: str, b: str) -> str:
        """Find the closest common ancestor of two branches or commits."""
        return common_ancestor(
            self._resolve_commit_ref(a), self._resolve_commit_ref(b), self._storage.get_commit
        )

    def diff(self, a: str, b: str) -> Diff:
        """Compare message additions and estimated token counts since the common ancestor."""
        return build_diff(
            self._resolve_commit_ref(a), self._resolve_commit_ref(b), self._storage.get_commit
        )

    def preview_merge(
        self,
        source: str,
        into: str | None = None,
        *,
        provider: LLMProvider | None = None,
    ) -> MergePreview:
        """Build a non-mutating merge proposal; conflicts require explicit resolution."""
        target = into or self._storage.get_current_branch()
        source_head = self._storage.get_branch(source).head_commit_id
        target_head = self._storage.get_branch(target).head_commit_id
        ancestor_id = common_ancestor(source_head, target_head, self._storage.get_commit)
        source_messages = messages_since(source_head, ancestor_id, self._storage.get_commit)
        target_messages = messages_since(target_head, ancestor_id, self._storage.get_commit)
        extraction, fallback = extract_semantics(source_messages, target_messages, provider)
        conflicts = extraction.conflicts
        summary = extraction.summary.strip()
        if not summary:
            summary = "Merge changes: " + "; ".join(
                extraction.decisions
                + extraction.facts
                + extraction.dead_ends
                + extraction.open_questions
            )
        if not summary or summary == "Merge changes: " or fallback:
            summary = (
                "Verbatim branch changes:"
                + chr(10)
                + chr(10).join(f"[{message.role}] {message.content}" for message in source_messages)
            )
            if not source_messages:
                summary = "No source messages since common ancestor."
        return MergePreview(
            source_branch=source,
            target_branch=target,
            source_head_id=source_head,
            target_head_id=target_head,
            ancestor_id=ancestor_id,
            extraction=extraction,
            conflicts=conflicts,
            messages=[Message(role="assistant", content=summary)],
            summary=summary,
            summary_confidence="low" if fallback else "high",
            fallback=fallback,
        )

    def apply_merge(
        self,
        preview: MergePreview,
        *,
        resolutions: dict[str, str] | None = None,
        summary: str | None = None,
        author: str | None = None,
    ) -> Commit:
        """Apply an approved preview after validating branch heads and every conflict resolution."""
        if self._storage.get_branch(preview.source_branch).head_commit_id != preview.source_head_id:
            raise StaleMergePreview("source branch moved after the merge preview")
        if self._storage.get_branch(preview.target_branch).head_commit_id != preview.target_head_id:
            raise StaleMergePreview("target branch moved after the merge preview")
        choices = resolutions or {}
        conflict_ids = {conflict.id for conflict in preview.conflicts}
        if set(choices) - conflict_ids:
            raise InvalidMergeResolution("resolution provided for an unknown conflict")
        unresolved = conflict_ids - choices.keys()
        if unresolved:
            raise MergeConflict(
                f"resolve all conflicts before applying: {', '.join(sorted(unresolved))}"
            )
        resolved_lines: list[str] = []
        for conflict_id, choice in choices.items():
            if choice not in {"source", "target"} and not choice.strip():
                raise InvalidMergeResolution(f"empty resolution for conflict '{conflict_id}'")
        final_summary = (summary if summary is not None else preview.summary).strip()
        if not final_summary:
            raise InvalidMergeResolution("merge summary cannot be empty")
        for conflict in preview.conflicts:
            resolution = choices[conflict.id]
            if resolution == "source":
                selected = conflict.source
            elif resolution == "target":
                selected = conflict.target
            else:
                selected = resolution.strip()
            resolved_lines.append(f"Resolved {conflict.topic}: {selected}")
        if resolved_lines:
            final_summary += chr(10) + chr(10) + (chr(10) + chr(10)).join(resolved_lines)
        parent_ids = [preview.target_head_id, preview.source_head_id]
        model = self._storage.get_commit(preview.target_head_id).model
        message = Message(role="assistant", content=final_summary)
        cid = hashing.commit_id(
            parent_ids=parent_ids,
            messages=[("assistant", final_summary)],
            kind="merge",
            model=model,
        )
        commit = Commit(
            id=cid,
            parent_ids=parent_ids,
            messages=[message],
            kind="merge",
            model=model,
            summary=final_summary,
            token_count=self.count_tokens(preview.target_head_id, model),
            author=author,
        )
        self._storage.insert_commit(commit)
        self._storage.update_branch_head(
            preview.target_branch, cid, expected_head_id=preview.target_head_id
        )
        return commit

    def merge(
        self,
        source: str,
        into: str | None = None,
        dry_run: bool = True,
        *,
        provider: LLMProvider | None = None,
        resolutions: dict[str, str] | None = None,
        summary: str | None = None,
    ) -> MergePreview | Commit:
        """Preview by default; when applying, require explicit conflict resolutions."""
        preview = self.preview_merge(source, into, provider=provider)
        if dry_run:
            return preview
        return self.apply_merge(preview, resolutions=resolutions, summary=summary)

    def note(
        self,
        content: str,
        *,
        summary: str | None = None,
        branch: str | None = None,
        author: str | None = None,
    ) -> Commit:
        """Record a dead-end or observation as a cheap note commit."""
        return self.commit(
            [Message(role="assistant", content=content)],
            model="none",
            summary=summary or content,
            author=author,
            kind="note",
            branch=branch,
        )

    # ---------- sessions (parallel AI runs) ----------

    def create_session(
        self,
        name: str,
        *,
        kind: str = "chat",
        branch: str | None = None,
        agent: str | None = None,
        auto_commit: bool = False,
        from_commit: str | None = None,
        project_path: str | None = None,
        worktree: bool = False,
        base_ref: str | None = None,
        task: str | None = None,
        scope: list[str] | None = None,
        role: str | None = None,
        skills: list[str] | None = None,
    ) -> Session:
        """Create a session bound to a branch (creating the branch if needed).

        Each session owns a staging buffer; messages staged here become one
        commit when the user calls `commit_staged`. When `worktree` is set and
        `project_path` is a git repository, the session also gets its own git
        worktree (code) paired with this branch (conversation).
        """
        if kind not in {"chat", "terminal"}:
            raise InvalidRefName(f"unknown session kind: {kind!r}")
        branch_name = branch or self._unique_branch_name(name)
        if not self._branch_exists(branch_name):
            self.branch(branch_name, from_commit=from_commit)
        elif self._storage.branch_is_trashed(branch_name):
            # Reusing a name that is sitting in Storage: bring the branch back
            # rather than binding this run to a hidden pointer.
            self._storage.restore_branch(branch_name)
        session = Session(
            id=uuid4().hex,
            name=name,
            kind=cast("Literal['chat', 'terminal']", kind),
            branch=branch_name,
            agent=agent,
            auto_commit=auto_commit,
            task=task,
            scope=scope or [],
            role=role,
            skills=skills or [],
            project_path=project_path,
        )
        if worktree and project_path:
            self._attach_worktree(session, project_path, base_ref)
        self._storage.insert_session(session)
        if session.scope:
            self._storage.insert_claims(session.id, session.scope, session.created_at.isoformat())
        if project_path:
            # What this run could see. Best-effort: a capture failure must never
            # stop a run from starting.
            self.record_run_env(session.id)
        if project_path and session.worktree_path:
            self.sync_agent_context(project_path, self.shared_context(session.id))
        return session

    def _attach_worktree(self, session: Session, project_path: str, base_ref: str | None) -> None:
        """Give a session its own git worktree + branch, paired with its DAG branch."""
        manager = WorktreeManager(project_path)
        if not manager.available:
            return  # non-git project: sessions share the workspace folder
        base = self._resolve_base(manager.git, base_ref)
        path = manager.create(session.branch, branch=f"ctx/{session.branch}", base=base)
        session.worktree_path = str(path)
        session.git_branch = f"ctx/{session.branch}"
        session.base_ref = base_ref or "head"
        session.base_commit = manager.git.rev_parse(base)
        # A private local port, so two runs' dev servers cannot collide.
        session.port = self._next_port()

    @staticmethod
    def _resolve_base(git: Git, base_ref: str | None) -> str:
        """Turn a base_ref choice into a git ref to branch from."""
        if base_ref in (None, "", "head"):
            return "HEAD"
        if base_ref == "fresh":
            default = git.run("rev-parse", "--verify", "origin/HEAD", check=False)
            return "origin/HEAD" if default.returncode == 0 else "HEAD"
        if base_ref.startswith("-"):
            raise InvalidRefName("base_ref cannot start with '-'")
        try:
            git.rev_parse(base_ref)
        except GitCommandError as exc:
            raise InvalidRefName(f"unknown base_ref: {base_ref!r}") from exc
        return base_ref

    def get_session(self, session_id: str) -> Session:
        return self._storage.get_session(session_id)

    def list_sessions(self) -> list[Session]:
        self._backfill_session_projects()
        return self._storage.list_sessions()

    def list_trashed_sessions(self) -> list[Session]:
        """Runs and conversations currently in Storage (trash)."""
        return self._storage.list_trashed_sessions()

    def _backfill_session_projects(self) -> None:
        """Fill project_path for runs recorded before it existed (from their worktree)."""
        if self._projects_backfilled:
            return
        self._projects_backfilled = True
        for session in self._storage.list_sessions():
            if session.project_path or not session.worktree_path:
                continue
            project = _project_from_worktree(session.worktree_path)
            if project:
                session.project_path = project
                self._storage.update_session(session)

    def set_session_status(self, session_id: str, status: str) -> Session:
        """Update a session's lifecycle status (idle/running/done/error)."""
        if status not in {"idle", "running", "done", "error"}:
            raise InvalidRefName(f"unknown session status: {status!r}")
        session = self._storage.get_session(session_id)
        session.status = cast("Literal['idle', 'running', 'done', 'error']", status)
        session.updated_at = utcnow()
        self._storage.update_session(session)
        return session

    def rename_session(self, session_id: str, name: str) -> Session:
        session = self._storage.get_session(session_id)
        session.name = name
        session.updated_at = utcnow()
        self._storage.update_session(session)
        return session

    def set_session_auto_commit(self, session_id: str, enabled: bool) -> Session:
        session = self._storage.get_session(session_id)
        session.auto_commit = enabled
        session.updated_at = utcnow()
        self._storage.update_session(session)
        return session

    def trash_session(self, session_id: str) -> Session:
        """Move a run to Storage (trash): hidden from listings, restorable.

        The worktree and commits are left untouched, so nothing is lost while
        the run sits in Storage.
        """
        session = self._storage.get_session(session_id)
        now = utcnow()
        session.deleted_at = now
        session.status = "idle"
        session.updated_at = now
        self._storage.update_session(session)
        return session

    def restore_session(self, session_id: str) -> Session:
        """Bring a trashed run back into the normal listings.

        A conversation's branch is restored with it, so the pair comes back whole.
        """
        session = self._storage.get_session(session_id)
        session.deleted_at = None
        session.updated_at = utcnow()
        self._storage.update_session(session)
        if self._storage.branch_is_trashed(session.branch):
            self._storage.restore_branch(session.branch)
        return session

    def delete_session(self, session_id: str, *, remove_worktree: bool = True) -> None:
        """Permanently delete a session and its staged messages. Commits/branches survive.

        The session's git worktree is removed when clean; a worktree with
        uncommitted changes is kept so no work is lost. Callers that want to
        keep the run recoverable should use `trash_session` instead.
        """
        session = self._storage.get_session(session_id)
        if remove_worktree and session.worktree_path:
            self._remove_worktree(session.worktree_path)
        self._storage.delete_session(session_id)

    @staticmethod
    def _remove_worktree(worktree_path: str) -> None:
        """Best-effort cleanup; keep the worktree if it holds uncommitted work."""
        try:
            WorktreeManager.from_worktree(worktree_path).remove(Path(worktree_path).name)
        except (DirtyWorktree, WorktreeNotFound, NotAGitRepo, GitCommandError, ValueError):
            return

    # ---------- fleet (code status of parallel runs) ----------

    def session_workspace(self, session_id: str, *, target: str | None = None) -> WorkspaceStatus:
        """Code state of one run's worktree (empty for shared-workspace runs)."""
        session = self._storage.get_session(session_id)
        return workspace_status(
            session_id=session.id,
            worktree_path=session.worktree_path,
            base_commit=session.base_commit,
            git_branch=session.git_branch,
            target=target,
        )

    def fleet(self) -> list[FleetEntry]:
        """Every session with its code state, changed files and file overlaps.

        Reads git once per run; the UI polls this, so keep the run count small.
        """
        entries: list[FleetEntry] = []
        for session in self._storage.list_sessions():
            workspace = workspace_status(
                session_id=session.id,
                worktree_path=session.worktree_path,
                base_commit=session.base_commit,
                git_branch=session.git_branch,
            )
            entries.append(
                FleetEntry(
                    session_id=session.id,
                    name=session.name,
                    agent=session.agent,
                    status=session.status,
                    branch=session.branch,
                    git_branch=workspace.git_branch,
                    worktree_path=workspace.worktree_path,
                    changed_files=workspace.changed_files,
                    ahead=workspace.ahead,
                    behind=workspace.behind,
                    clean=workspace.clean,
                )
            )
        changed = {entry.session_id: set(entry.changed_files) for entry in entries}
        for entry in entries:
            mine = changed[entry.session_id]
            if not mine:
                continue
            entry.overlaps = [
                other.session_id
                for other in entries
                if other.session_id != entry.session_id and changed[other.session_id] & mine
            ]
        return entries

    # ---------- claims + context (keep parallel runs off each other's files) ----------

    def claim(self, session_id: str, globs: list[str]) -> list[str]:
        """Record the file scope a run owns, replacing any previous claim."""
        session = self._storage.get_session(session_id)
        self._storage.delete_claims(session_id)
        if globs:
            self._storage.insert_claims(session_id, globs, utcnow().isoformat())
        session.scope = list(globs)
        session.updated_at = utcnow()
        self._storage.update_session(session)
        return self._storage.session_claims(session_id)

    def session_claims(self, session_id: str) -> list[str]:
        """The globs a run currently claims."""
        self._storage.get_session(session_id)
        return self._storage.session_claims(session_id)

    def claim_conflicts(
        self, globs: list[str], *, exclude_session_id: str | None = None
    ) -> list[str]:
        """Sessions whose claimed files overlap `globs` (excluding one session)."""
        if not globs:
            return []
        return sorted(
            session_id
            for session_id, claims in self._storage.claims_by_session().items()
            if session_id != exclude_session_id and any_overlap(globs, claims)
        )

    def sync_agent_context(self, project_path: str, digest: str | None = None) -> None:
        """Rewrite the managed AGENTS.md block with runs' scopes, shared context,
        and the alternatives already rejected in the files these runs own."""
        sessions = [session for session in self._storage.list_sessions() if session.worktree_path]
        runs = [
            {
                "name": session.name,
                "agent": session.agent or "",
                "scope": ", ".join(session.scope),
                "role": session.role or "",
                "skills": ", ".join(session.skills),
            }
            for session in sessions
        ]
        scope = [glob for session in sessions for glob in session.scope]
        rejected = self.rejected_alternatives(project_path, scope)
        write_context_block(project_path, context_document(runs, digest, rejected))

    def rejected_alternatives(
        self, project_path: str, scope: list[str], *, limit: int = 6
    ) -> list[str]:
        """Dead ends recorded for these paths, from extractions we already have.

        Cache-only on purpose: starting a run must never cost an LLM call.
        """
        from contextgit.memory.bundle import memory_for  # noqa: PLC0415 — avoids a cycle

        if not scope:
            return []
        try:
            bundle = memory_for(self, None, project_path, scope, scoped_by="run scope")
        except Exception:
            return []
        return bundle.dead_ends[:limit]

    # ---------- run environments (names + hashes, never values) ----------

    def record_run_env(self, session_id: str) -> list[EnvEntry]:
        """Capture this run's environment, so a later diff can explain a regression."""
        session = self.get_session(session_id)
        if not session.project_path:
            return []
        try:
            entries = capture_env(session.project_path, dict(os.environ))
        except Exception:
            return []
        if entries:
            self._storage.record_run_env(session_id, entries)
        return entries

    def run_env(self, session_id: str) -> list[EnvEntry]:
        """One run's recorded variables (names + hashes)."""
        return [
            EnvEntry(key=row["key"], hash=row["hash"], source=row["source"])
            for row in self._storage.list_run_env(session_id)
        ]

    def env_drift(self, session_id: str, against: str) -> list[EnvDrift]:
        """How `session_id`'s environment differs from another run's."""
        return diff_env(self.run_env(against), self.run_env(session_id))

    # ---------- team mode (a task graph over parallel runs) ----------

    def current_team(self) -> Team | None:
        """The team for this repository — the most recently created one, if any."""
        teams = self._storage.list_teams()
        return teams[-1] if teams else None

    def create_team(self, name: str, *, project_path: str, base_ref: str | None = None) -> Team:
        """Create the mission every task hangs off. One team per repository."""
        project = Path(project_path)
        resolved = base_ref
        if not resolved and project.is_dir():
            git = Git(project)
            if git.is_repo():
                resolved = git.current_branch()
        team = Team(
            id=uuid4().hex,
            name=name,
            project_path=str(project),
            base_ref=resolved,
            # A project that already declares a test command gets it for free.
            gate_command=detect_gate(project),
        )
        self._storage.insert_team(team)
        self._record(team.id, "team_created", None, {"name": name, "base_ref": resolved})
        self.sync_team_board(team.id)
        return team

    def get_team(self, team_id: str) -> Team:
        return self._storage.get_team(team_id)

    def set_team_gate(self, team_id: str, command: str | None) -> Team:
        """Set (or clear, with an empty string) the team's default gate command."""
        team = self._storage.get_team(team_id)
        team.gate_command = command or None
        team.updated_at = utcnow()
        self._storage.update_team(team)
        self.sync_team_board(team_id)
        return team

    def team_board(self, team_id: str | None = None) -> TeamBoard | None:
        """The board the UI renders: team, task graph and message feed."""
        team = self._storage.get_team(team_id) if team_id else self.current_team()
        if team is None:
            return None
        return TeamBoard(
            team=team,
            tasks=self.list_tasks(team.id),
            messages=self._storage.list_team_messages(team.id, limit=50),
            current_branch=self.current_branch(),
        )

    def _fill_tasks(self, tasks: list[Task], deps: dict[str, list[str]]) -> list[Task]:
        """Attach the derived fields (never stored on the row): deps + context size."""
        status = {task.id: task.status for task in tasks}
        for task in tasks:
            task.depends_on = list(deps.get(task.id, []))
            task.blocked_by = [dep for dep in task.depends_on if status.get(dep) != "done"]
            task.tokens = self._task_tokens(task)
        return tasks

    def _load_tasks(self, team_id: str) -> tuple[list[Task], dict[str, list[str]]]:
        deps = self._storage.task_deps(team_id)
        return self._fill_tasks(self._storage.list_tasks(team_id), deps), deps

    def _task_tokens(self, task: Task) -> int:
        """Committed context size of a task's run, plus what it has staged.

        A deliberately rough proxy (4 chars ~ 1 token for staged text): a PTY
        agent's live token usage is not observable, so we count what we own.
        """
        session_id = task.session_id or task.verifier_session_id
        if not session_id:
            return 0
        try:
            session = self._storage.get_session(session_id)
        except SessionNotFound:
            return 0
        try:
            total = sum(commit.token_count for commit in self.log(session.branch))
        except BranchNotFound:
            total = 0
        return total + sum(
            len(message.content) // 4 for message in self._storage.staged_messages(session.id)
        )

    def _gate_command_for(self, task: Task, team: Team, worktree: str | None) -> str | None:
        """Task override, then the team default, then whatever the project declares."""
        if task.gate_command:
            return task.gate_command
        if team.gate_command:
            return team.gate_command
        return detect_gate(worktree or team.project_path)

    def _max_active(self) -> int:
        raw = os.getenv("CONTEXTGIT_MAX_ACTIVE")
        try:
            return max(1, int(raw)) if raw else _DEFAULT_MAX_ACTIVE
        except ValueError:
            return _DEFAULT_MAX_ACTIVE

    def _active_count(self, team_id: str) -> int:
        return sum(1 for task in self._storage.list_tasks(team_id) if task.status == "working")

    def _next_port(self) -> int:
        """The next free run port; monotonic, so two runs never share one."""
        raw = os.getenv("CONTEXTGIT_PORT_BASE")
        try:
            base = int(raw) if raw else _DEFAULT_PORT_BASE
        except ValueError:
            base = _DEFAULT_PORT_BASE
        used = [session.port for session in self._storage.list_sessions() if session.port]
        return max(used, default=base) + 1

    def list_tasks(self, team_id: str) -> list[Task]:
        """Every task in the team, with `depends_on` / `blocked_by` filled in."""
        return self._load_tasks(team_id)[0]

    def get_task(self, task_id: str) -> Task:
        task = self._storage.get_task(task_id)
        for candidate in self.list_tasks(task.team_id):
            if candidate.id == task_id:
                return candidate
        return task

    def create_task(
        self,
        team_id: str,
        *,
        title: str,
        brief: str = "",
        done_criteria: str = "",
        role: str = "implementer",
        agent: str | None = None,
        scope: list[str] | None = None,
        contract: str | None = None,
        depends_on: list[str] | None = None,
        gate_command: str | None = None,
    ) -> Task:
        """Add one task to the graph. A contract file is added to its claims."""
        self._storage.get_team(team_id)
        globs = list(scope or [])
        if contract and contract not in globs:
            globs.append(contract)
        for dep in depends_on or []:
            if self._storage.get_task(dep).team_id != team_id:
                raise InvalidRefName("a task can only depend on a task in the same team")
        task = Task(
            id=uuid4().hex,
            team_id=team_id,
            title=title,
            brief=brief,
            done_criteria=done_criteria,
            role=role,
            agent=agent,
            scope=globs,
            contract=contract or None,
            gate_command=gate_command or None,
            position=self._storage.next_task_position(team_id),
        )
        self._storage.insert_task(task)
        for dep in depends_on or []:
            self._storage.add_task_dep(task.id, dep)
        tasks, deps = self._load_tasks(team_id)
        try:
            validate_graph([item.id for item in tasks], deps)
        except TaskCycleError:
            self._storage.delete_task(task.id)
            raise
        self._record(team_id, "task_created", task.id, {"title": title})
        self.sync_team_board(team_id)
        return self.get_task(task.id)

    def update_task(
        self,
        task_id: str,
        *,
        title: str | None = None,
        brief: str | None = None,
        done_criteria: str | None = None,
        role: str | None = None,
        agent: str | None = None,
        scope: list[str] | None = None,
        contract: str | None = None,
        status: str | None = None,
        gate_command: str | None = None,
    ) -> Task:
        """Edit a task's fields. Use `set_task_deps` for its dependency edges."""
        task = self._storage.get_task(task_id)
        if title is not None:
            task.title = title
        if brief is not None:
            task.brief = brief
        if done_criteria is not None:
            task.done_criteria = done_criteria
        if role is not None:
            task.role = role
        if agent is not None:
            task.agent = agent
        if gate_command is not None:
            task.gate_command = gate_command or None
        if scope is not None:
            task.scope = list(scope)
        if contract is not None:
            task.contract = contract or None
        if contract and contract not in task.scope:
            task.scope.append(contract)
        if status is not None:
            if status not in STATUS_ORDER:
                raise InvalidRefName(f"unknown task status: {status!r}")
            if status == "done":
                raise TaskNotReviewable("tasks become done only through the approval flow")
            task.status = status
        task.updated_at = utcnow()
        self._storage.update_task(task)
        self.sync_team_board(task.team_id)
        return self.get_task(task_id)

    def set_task_deps(self, task_id: str, depends_on: list[str]) -> Task:
        """Replace a task's dependencies (validated: same team, no cycles)."""
        task = self._storage.get_task(task_id)
        tasks, deps = self._load_tasks(task.team_id)
        cleaned: list[str] = []
        for dep in depends_on:
            if self._storage.get_task(dep).team_id != task.team_id:
                raise InvalidRefName("a task can only depend on a task in the same team")
            if dep not in cleaned:
                cleaned.append(dep)
        prospective = {key: list(value) for key, value in deps.items()}
        prospective[task_id] = cleaned
        validate_graph([item.id for item in tasks], prospective)
        for existing in deps.get(task_id, []):
            self._storage.remove_task_dep(task_id, existing)
        for dep in cleaned:
            self._storage.add_task_dep(task_id, dep)
        self.sync_team_board(task.team_id)
        return self.get_task(task_id)

    def delete_task(self, task_id: str) -> None:
        task = self._storage.get_task(task_id)
        self._storage.delete_task(task_id)
        self._record(task.team_id, "task_deleted", None, {"title": task.title})
        self.sync_team_board(task.team_id)

    def post_message(
        self,
        team_id: str,
        body: str,
        *,
        kind: str = "update",
        task_id: str | None = None,
        from_task_id: str | None = None,
    ) -> TeamMessage:
        """Append a line to the board feed, then rewrite the board file."""
        self._storage.get_team(team_id)
        if kind not in TEAM_MESSAGE_KINDS:
            raise InvalidRefName(f"unknown message kind: {kind!r}")
        message = TeamMessage(
            id=0,
            team_id=team_id,
            task_id=task_id,
            from_task_id=from_task_id,
            kind=cast("TeamMessageKind", kind),
            body=body,
        )
        stored = self._storage.insert_team_message(message)
        self.sync_team_board(team_id)
        return stored

    def team_messages(self, team_id: str, *, limit: int | None = 50) -> list[TeamMessage]:
        return self._storage.list_team_messages(team_id, limit=limit)

    def sync_team_board(self, team_id: str) -> None:
        """Rewrite `.contextgit/team.md` and the managed AGENTS.md team block."""
        team = self._storage.get_team(team_id)
        write_team_board(
            team.project_path,
            team_document(
                team,
                self.list_tasks(team_id),
                self._storage.list_team_messages(team_id, limit=12),
            ),
        )

    def _record(
        self, team_id: str, kind: str, task_id: str | None, payload: dict[str, object]
    ) -> None:
        self._storage.insert_team_event(
            TeamEvent(id=0, team_id=team_id, kind=kind, task_id=task_id, payload=payload)
        )

    def _set_task_status(self, task_id: str, status: str) -> Task:
        if status not in STATUS_ORDER:
            raise InvalidRefName(f"unknown task status: {status!r}")
        task = self._storage.get_task(task_id)
        task.status = status
        task.updated_at = utcnow()
        self._storage.update_task(task)
        return task

    def start_task(self, task_id: str) -> Task:
        """Start one ready task: its own worktree, branch and terminal session.

        Enforced ownership: the task is refused if another run already claims
        any of its files (Single mode stays advisory; team mode blocks).
        """
        task = self._storage.get_task(task_id)
        team = self._storage.get_team(task.team_id)
        tasks, deps = self._load_tasks(task.team_id)
        tasks_by_id = {item.id: item for item in tasks}
        if task.session_id:
            return self.get_task(task_id)
        waiting = blocked_by(task_id, tasks_by_id, deps)
        if waiting:
            names = ", ".join(tasks_by_id[dep].title for dep in waiting)
            raise TaskDependencyError(f"'{task.title}' is waiting on {names}")
        if task.status == "done":
            raise TaskDependencyError(f"'{task.title}' is already done")
        active = self._active_count(task.team_id)
        if active >= self._max_active():
            raise WorkInProgressLimit(
                f"{active} runs are already active (cap {self._max_active()})"
            )
        owners = [self._storage.get_session(sid).name for sid in self.claim_conflicts(task.scope)]
        if owners:
            raise ScopeConflict(f"'{task.title}' claims files already owned by {', '.join(owners)}")
        session = self.create_session(
            f"{team.name}/{task.title}",
            kind="terminal",
            agent=task.agent,
            project_path=team.project_path,
            worktree=True,
            base_ref=team.base_ref,
            task=task.title,
            scope=task.scope,
        )
        task.session_id = session.id
        task.status = "working"
        task.updated_at = utcnow()
        self._storage.update_task(task)
        self._record(team.id, "task_started", task.id, {"session_id": session.id})
        self.post_message(
            team.id,
            f"started '{task.title}' on {session.git_branch or session.branch}",
            kind="system",
            task_id=task.id,
        )
        self.sync_team_board(team.id)
        return self.get_task(task_id)

    def launch_team(self, team_id: str | None = None) -> list[Task]:
        """Start every ready task; tasks with unmet deps show as blocked.

        Ownership is checked for the whole team *before* anything is created, so
        an overlapping plan is refused instead of half-launched.
        """
        team = self._storage.get_team(team_id) if team_id else self.current_team()
        if team is None:
            raise TeamNotFound("no team to launch")
        tasks, deps = self._load_tasks(team.id)
        tasks_by_id = {task.id: task for task in tasks}

        ready: list[str] = []
        for task_id in topological_order(list(tasks_by_id), deps):
            task = tasks_by_id[task_id]
            if task.status in {"done", "working", "review"}:
                continue
            if blocked_by(task_id, tasks_by_id, deps):
                self._set_task_status(task_id, "blocked")
                continue
            ready.append(task_id)

        claimed: list[tuple[str, list[str]]] = []
        for task_id in ready:
            task = tasks_by_id[task_id]
            owners = [
                self._storage.get_session(sid).name for sid in self.claim_conflicts(task.scope)
            ]
            colliding = [
                title for title, other in claimed if task.scope and any_overlap(task.scope, other)
            ]
            if owners or colliding:
                raise ScopeConflict(
                    f"'{task.title}' claims files already owned by "
                    f"{', '.join([*owners, *colliding])}"
                )
            claimed.append((task.title, task.scope))

        started: list[Task] = []
        for task_id in ready:
            try:
                started.append(self.start_task(task_id))
            except WorkInProgressLimit as limit:
                # Stop at the cap: the rest simply stay in `todo` for later.
                self._set_task_status(task_id, "todo")
                self._record(team.id, "wip_limit", task_id, {"reason": str(limit)})
                break
        # Make the live channel available to MCP-capable agent CLIs.
        ensure_mcp_config(team.project_path)
        self.sync_team_board(team.id)
        return started

    def complete_task(self, task_id: str) -> Task:
        """Finish a task: run its quality gate, then leave it waiting on review.

        The gate (when the project has one) decides the outcome: green lands the
        task in `review`, red sends it back to `working` with the output as
        feedback. Approval is what marks a task `done` and unblocks dependents.
        """
        task = self._storage.get_task(task_id)
        team = self._storage.get_team(task.team_id)
        if task.status == "done":
            return self.get_task(task_id)
        if task.session_id and self._gate_command_for(task, team, None):
            return self._queue_completed_task(self.run_task_gate(task_id))
        task.status = "review"
        task.updated_at = utcnow()
        self._storage.update_task(task)
        self._record(team.id, "task_completed", task.id, {})
        self.post_message(
            team.id, f"'{task.title}' is ready for review", kind="review", task_id=task.id
        )
        self.sync_team_board(team.id)
        return self._queue_completed_task(self.get_task(task_id))

    def run_task_gate(self, task_id: str) -> Task:
        """Run the project's gate inside the task's worktree and record the verdict."""
        task = self._storage.get_task(task_id)
        team = self._storage.get_team(task.team_id)
        if not task.session_id:
            raise TaskDependencyError(f"'{task.title}' has no run to gate yet")
        session = self._storage.get_session(task.session_id)
        command = self._gate_command_for(task, team, session.worktree_path)
        if not command:
            raise GateNotConfigured(f"no gate command configured for '{task.title}'")
        env = dict(os.environ)
        env["CONTEXTGIT_RUN"] = session.name
        if session.port:
            env["PORT"] = str(session.port)
        result = run_command(command, session.worktree_path or team.project_path, env=env)
        task.gate_command = command
        task.gate_status = "pass" if result.ok else "fail"
        task.gate_exit_code = result.exit_code
        task.gate_output = result.output
        task.gate_ran_at = utcnow()
        task.status = "review" if result.ok else "working"
        task.updated_at = utcnow()
        self._storage.update_task(task)
        self._record(
            team.id,
            "gate_ran",
            task.id,
            {"command": command, "exit_code": result.exit_code, "status": task.gate_status},
        )
        verdict = "passed" if result.ok else "failed"
        self.post_message(
            team.id,
            f"gate {verdict} for '{task.title}' — `{command}`",
            kind="gate",
            task_id=task.id,
        )
        self.sync_team_board(team.id)
        return self.get_task(task_id)

    def approve_task(self, task_id: str) -> Task:
        """Accept reviewed work: mark it done, then unblock and start dependents."""
        task = self._storage.get_task(task_id)
        team = self._storage.get_team(task.team_id)
        if task.status not in {"todo", "review"}:
            raise TaskNotReviewable(f"'{task.title}' is not waiting for review")
        if self._gate_command_for(task, team, None) and task.gate_status != "pass":
            raise TaskNotReviewable(f"'{task.title}' has not passed its quality gate")
        task.status = "done"
        task.updated_at = utcnow()
        self._storage.update_task(task)
        self._record(team.id, "task_approved", task.id, {})
        self.post_message(team.id, f"'{task.title}' approved", kind="review", task_id=task.id)

        tasks, deps = self._load_tasks(team.id)
        tasks_by_id = {item.id: item for item in tasks}
        for dependent_id in dependents(deps, task_id):
            dependent = tasks_by_id.get(dependent_id)
            if dependent is None or dependent.status not in {"todo", "blocked"}:
                continue
            if blocked_by(dependent_id, tasks_by_id, deps):
                self._set_task_status(dependent_id, "blocked")
                continue
            try:
                self.start_task(dependent_id)
            except (ScopeConflict, WorkInProgressLimit):
                self._set_task_status(dependent_id, "blocked")
        self.sync_team_board(team.id)
        return self.get_task(task_id)

    def reject_task(self, task_id: str, note: str) -> Task:
        """Send reviewed work back to the implementer with a note."""
        task = self._storage.get_task(task_id)
        team = self._storage.get_team(task.team_id)
        if task.status == "done":
            raise TaskNotReviewable(f"'{task.title}' is already done")
        task.status = "working"
        task.review_note = note
        task.updated_at = utcnow()
        self._storage.update_task(task)
        self._record(team.id, "task_rejected", task.id, {"note": note})
        self.post_message(
            team.id,
            f"changes requested on '{task.title}': {note}",
            kind="review",
            task_id=task.id,
        )
        self.sync_team_board(team.id)
        return self.get_task(task_id)

    def verify_task(self, task_id: str, *, agent: str | None = None) -> Task:
        """Start a read-only run that reviews this task's diff against its criteria.

        The verifier gets its own worktree branched from the implementer's, claims
        no files and writes no code, so it can never collide with the work. Its
        findings land on the board; the verdict stays with the human.
        """
        task = self._storage.get_task(task_id)
        team = self._storage.get_team(task.team_id)
        if task.verifier_session_id:
            return self.get_task(task_id)
        implementer = task.agent or ""
        reviewer = agent or next(
            (name for name in _VERIFIER_AGENTS if name != implementer), _VERIFIER_AGENTS[0]
        )
        implementer_session = (
            self._storage.get_session(task.session_id) if task.session_id else None
        )
        base_ref = (
            implementer_session.git_branch
            if implementer_session and implementer_session.git_branch
            else team.base_ref
        )
        session = self.create_session(
            f"{team.name}/verify {task.title}",
            kind="terminal",
            agent=reviewer,
            project_path=team.project_path,
            worktree=True,
            base_ref=base_ref,
            task=f"verify: {task.title}",
            scope=[],
        )
        task.verifier_session_id = session.id
        task.status = "review"
        task.updated_at = utcnow()
        self._storage.update_task(task)
        self._record(
            team.id, "verifier_started", task.id, {"session_id": session.id, "agent": reviewer}
        )
        self.post_message(
            team.id,
            f"verifier '{reviewer}' started on '{task.title}'",
            kind="review",
            task_id=task.id,
        )
        self.sync_team_board(team.id)
        return self.get_task(task_id)

    def queue_done_tasks(self, team_id: str | None = None) -> list[MergeQueueEntry]:
        """Enqueue every done task's run, in dependency order, for the merge queue."""
        team = self._storage.get_team(team_id) if team_id else self.current_team()
        if team is None:
            raise TeamNotFound("no team to merge")
        tasks, deps = self._load_tasks(team.id)
        tasks_by_id = {task.id: task for task in tasks}
        queued: list[MergeQueueEntry] = []
        for task_id in topological_order(list(tasks_by_id), deps):
            task = tasks_by_id[task_id]
            if task.status != "done" or not task.session_id:
                continue
            session = self._storage.get_session(task.session_id)
            if session.git_branch:
                queued.append(self.enqueue_merge(task.session_id))
        return queued

    # ---------- merge queue (sequential, checkout-free integration) ----------

    def enqueue_merge(self, session_id: str, target: str | None = None) -> MergeQueueEntry:
        """Add a run's branch to the merge queue for a target branch."""
        session = self._storage.get_session(session_id)
        if not session.git_branch or not session.worktree_path:
            raise InvalidRefName(f"run '{session.name}' has no worktree to merge")
        resolved = self._merge_target(session, target)
        return self._storage.insert_merge_entry(
            session_id, resolved, self._storage.next_merge_position(), utcnow().isoformat()
        )

    def merge_queue(self) -> list[MergeQueueEntry]:
        """Every queued/merged/blocked entry, in queue order."""
        return self._storage.list_merge_entries()

    def dequeue_merge(self, entry_id: int) -> None:
        """Remove an entry from the queue."""
        self._storage.delete_merge_entry(entry_id)

    def run_merge_queue(self, target: str | None = None) -> list[MergeQueueEntry]:
        """Merge queued runs into the target one at a time, in order.

        Each branch is re-checked against the *current* target (which moves as
        earlier runs merge), so conflicts surface before anything is written.
        Stops at the first blocked entry so later runs are not merged on top.
        """
        results: list[MergeQueueEntry] = []
        for entry in self._storage.list_merge_entries():
            if entry.status != "queued":
                continue
            session = self._storage.get_session(entry.session_id)
            if not session.git_branch or not session.worktree_path:
                entry.status = "failed"
                entry.conflicts = ["run has no worktree"]
                entry.updated_at = utcnow()
                self._storage.update_merge_entry(entry)
                results.append(entry)
                continue
            project = WorktreeManager.from_worktree(session.worktree_path).project
            target_ref = target or entry.target or self._merge_target(session, None)
            try:
                merged = integrate(
                    project,
                    target_ref,
                    session.git_branch,
                    message=f"Merge {session.name} ({session.agent or 'shell'})",
                )
            except IntegrationConflict as conflict:
                entry.status = "blocked"
                entry.conflicts = conflict.conflicted_files
                entry.updated_at = utcnow()
                self._storage.update_merge_entry(entry)
                results.append(entry)
                break
            entry.status = "merged"
            entry.commit_id = merged.commit_id
            entry.conflicts = []
            entry.updated_at = utcnow()
            self._storage.update_merge_entry(entry)
            results.append(entry)
        return results

    def _merge_target(self, session: Session, target: str | None) -> str:
        """Resolve the branch a run should merge into."""
        if target:
            return target
        if session.worktree_path:
            project = WorktreeManager.from_worktree(session.worktree_path).project
            return Git(project).current_branch()
        return self.current_branch()

    # ---------- context pairing (merge code and conversation together) ----------

    def integrate_run(
        self,
        session_id: str,
        *,
        target: str | None = None,
        git_target: str | None = None,
        provider: LLMProvider | None = None,
    ) -> PairedMerge:
        """Merge a run's branch into the target **and** its context branch.

        Code lands on the git target branch and the conversation on the
        ContextGit branch in one action. Raises MergeConflict when the context
        branches disagree (resolve that through the normal merge preview first).
        """
        session = self._storage.get_session(session_id)
        if not session.git_branch or not session.worktree_path:
            raise InvalidRefName(f"run '{session.name}' has no worktree to integrate")
        project = WorktreeManager.from_worktree(session.worktree_path).project
        resolved_git = git_target or Git(project).current_branch()
        context_target = target or self.current_branch()
        preview = self.preview_merge(session.branch, context_target, provider=provider)
        if preview.conflicts:
            topics = ", ".join(conflict.topic for conflict in preview.conflicts)
            raise MergeConflict(f"context conflicts on: {topics}")
        git = Git(project)
        target_commit = git.rev_parse(resolved_git)
        code = integrate(
            project,
            resolved_git,
            session.git_branch,
            message=f"Merge {session.name} ({session.agent or 'shell'})",
            target_commit=target_commit,
        )
        context_commit = self.apply_merge(
            preview, summary=f"Merge {session.name} ({session.agent or 'shell'})"
        )
        return PairedMerge(
            source_branch=session.branch,
            git_target=resolved_git,
            context_target=context_target,
            code_commit_id=code.commit_id,
            context_commit_id=context_commit.id,
        )

    def shared_context(self, session_id: str, *, limit: int = 4) -> str:
        """A digest of what the other runs learned, for injection into this run.

        Reads each other run's context branch since its common ancestor with this
        run, so a later run does not repeat or contradict earlier decisions.
        """
        me = self._storage.get_session(session_id)
        my_head = self._storage.get_branch(me.branch).head_commit_id
        blocks: list[str] = []
        for other in self._storage.list_sessions():
            if other.id == session_id or not other.worktree_path:
                continue
            other_head = self._storage.get_branch(other.branch).head_commit_id
            try:
                ancestor = common_ancestor(my_head, other_head, self._storage.get_commit)
            except CommitNotFound:
                continue
            messages = messages_since(other_head, ancestor, self._storage.get_commit)
            if not messages:
                continue
            heading = f"### {other.name} [{other.agent or 'shell'}]"
            if other.task:
                heading += f" - {other.task}"
            lines = [heading]
            for message in messages[-limit:]:
                text = " ".join(message.content.split())
                lines.append(f"- {message.role}: {text[:160]}")
            blocks.append("\n".join(lines))
        if not blocks:
            return ""
        return "## Shared context (other runs)\n\n" + "\n\n".join(blocks)

    def cross_run_conflicts(
        self, session_id: str, *, provider: LLMProvider | None = None
    ) -> list[CrossRunConflict]:
        """Semantic conflicts between this run's context and every other run's."""
        if provider is None:
            return []
        me = self._storage.get_session(session_id)
        my_head = self._storage.get_branch(me.branch).head_commit_id
        results: list[CrossRunConflict] = []
        for other in self._storage.list_sessions():
            if other.id == session_id or not other.worktree_path:
                continue
            other_head = self._storage.get_branch(other.branch).head_commit_id
            try:
                ancestor = common_ancestor(my_head, other_head, self._storage.get_commit)
            except CommitNotFound:
                continue
            mine = messages_since(my_head, ancestor, self._storage.get_commit)
            theirs = messages_since(other_head, ancestor, self._storage.get_commit)
            if not mine or not theirs:
                continue
            extraction, _ = extract_semantics(theirs, mine, provider)
            if extraction.conflicts:
                results.append(
                    CrossRunConflict(
                        session_id=other.id, name=other.name, conflicts=extraction.conflicts
                    )
                )
        return results

    # ---------- staging (commit on demand) ----------

    def stage(self, session_id: str, messages: list[Message]) -> list[Message]:
        """Add messages to a session's staging buffer; nothing is committed."""
        if not messages:
            raise StagingEmpty("cannot stage an empty message list")
        self._storage.get_session(session_id)  # validates the session exists
        self._storage.append_staged(session_id, messages)
        return self._storage.staged_messages(session_id)

    def staged(self, session_id: str) -> list[Message]:
        """Current staging buffer for a session (empty list if none)."""
        self._storage.get_session(session_id)
        return self._storage.staged_messages(session_id)

    def unstage(self, session_id: str, last_only: bool = False) -> list[Message]:
        """Clear the staging buffer (or remove just the newest message)."""
        self._storage.get_session(session_id)
        if last_only:
            self._storage.unstage_last(session_id)
        else:
            self._storage.clear_staged(session_id)
        return self._storage.staged_messages(session_id)

    def commit_staged(
        self,
        session_id: str,
        *,
        summary: str | None = None,
        model: str | None = None,
        author: str | None = None,
    ) -> Commit:
        """Commit the staged messages on the session's branch, then clear staging.

        Raises StagingEmpty when there is nothing to commit. The commit lands
        on the session's branch regardless of the repo's current HEAD.
        """
        session = self._storage.get_session(session_id)
        messages = self._storage.staged_messages(session_id)
        if not messages:
            raise StagingEmpty(f"session '{session.name}' has no staged messages")
        commit = self.commit(
            messages,
            model=model or session.agent or "none",
            summary=summary
            or next((m.content for m in messages if m.role == "user"), messages[0].content)[:120],
            author=author,
            branch=session.branch,
        )
        self._storage.clear_staged(session_id)
        session.updated_at = utcnow()
        self._storage.update_session(session)
        if session.kind == "terminal":
            # A PTY agent's live usage is not observable, so record an estimate
            # from the text we own, attributed to the CLI harness. Chat turns are
            # recorded at call time instead (so we never double count).
            prompt = sum(self._estimate_text(m.content) for m in messages if m.role != "assistant")
            completion = sum(
                self._estimate_text(m.content) for m in messages if m.role == "assistant"
            )
            self.record_usage(
                session.agent or "cli",
                session.agent or "cli",
                "code",
                source="estimate",
                prompt_tokens=prompt,
                completion_tokens=completion,
                session_id=session.id,
                branch=session.branch,
            )
        return commit

    @staticmethod
    def _estimate_text(text: str) -> int:
        """The repository's documented ~4-chars-per-token heuristic for one string."""
        return (len(text) + 3) // 4 if text else 0

    def record_usage(
        self,
        provider: str,
        model: str,
        surface: UsageSurface,
        *,
        source: UsageSource,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        session_id: str | None = None,
        branch: str | None = None,
    ) -> None:
        """Append one usage event: real provider usage, or an estimate."""
        prompt = max(0, prompt_tokens)
        completion = max(0, completion_tokens)
        self._storage.insert_usage(
            UsageEvent(
                provider=provider or "unknown",
                model=model or "unknown",
                surface=surface,
                source=source,
                prompt_tokens=prompt,
                completion_tokens=completion,
                total_tokens=prompt + completion,
                session_id=session_id,
                branch=branch,
            )
        )

    def backfill_usage(self) -> int:
        """Seed the usage log once from committed history.

        Real per-call usage is only observable going forward, so past work is
        reconstructed from the commits themselves (estimated), attributed to the
        commit's model and tagged `estimate`. Idempotent: runs only while the
        usage log is empty, so it never double counts.
        """
        if self._storage.list_usage():
            return 0
        commits = self.all_commits()
        if not commits:
            return 0
        terminal_branches = {
            session.branch
            for session in self._storage.list_sessions()
            if session.kind == "terminal"
        }
        branch_of: dict[str, str] = {}
        for ref in self._storage.list_branches():
            for commit in self.log(ref.name):
                branch_of.setdefault(commit.id, ref.name)
        seeded = 0
        for commit in commits:
            if commit.kind == "root":
                continue
            prompt = sum(
                self._estimate_text(m.content) for m in commit.messages if m.role != "assistant"
            )
            completion = sum(
                self._estimate_text(m.content) for m in commit.messages if m.role == "assistant"
            )
            if prompt == 0 and completion == 0:
                continue
            branch_name = branch_of.get(commit.id)
            self._storage.insert_usage(
                UsageEvent(
                    provider=commit.model or "unknown",
                    model=commit.model or "unknown",
                    surface="code" if branch_name in terminal_branches else "chat",
                    source="estimate",
                    prompt_tokens=prompt,
                    completion_tokens=completion,
                    total_tokens=prompt + completion,
                    branch=branch_name,
                    created_at=commit.created_at,
                )
            )
            seeded += 1
        return seeded

    def usage_summary(self, since: datetime | None = None) -> UsageSummary:
        """Merge every usage event (optionally since a time) into totals + buckets."""
        # First call on a pre-existing repository reconstructs history, so the
        # Usage tab is not empty for work done before recording existed.
        self.backfill_usage()
        events = self._storage.list_usage(since.isoformat() if since else None)

        def totals_of(rows: list[UsageEvent]) -> UsageTotals:
            prompt = sum(event.prompt_tokens for event in rows)
            completion = sum(event.completion_tokens for event in rows)
            return UsageTotals(
                prompt_tokens=prompt,
                completion_tokens=completion,
                total_tokens=prompt + completion,
                estimated_tokens=sum(
                    event.total_tokens for event in rows if event.source == "estimate"
                ),
                calls=len(rows),
            )

        def bucket(
            source: list[UsageEvent],
            key_of: "Callable[[UsageEvent], tuple[object, ...]]",
        ) -> list[list[UsageEvent]]:
            grouped: dict[tuple[object, ...], list[UsageEvent]] = {}
            for event in source:
                grouped.setdefault(key_of(event), []).append(event)
            return list(grouped.values())

        def days_of(source: list[UsageEvent]) -> list[UsageDay]:
            return sorted(
                (
                    UsageDay(date=rows[0].created_at.date().isoformat(), totals=totals_of(rows))
                    for rows in bucket(source, lambda event: (event.created_at.date(),))
                ),
                key=lambda row: row.date,
            )

        by_provider = sorted(
            (
                UsageRow(
                    provider=rows[0].provider,
                    model=rows[0].model,
                    totals=totals_of(rows),
                )
                for rows in bucket(events, lambda event: (event.provider, event.model))
            ),
            key=lambda row: row.totals.total_tokens,
            reverse=True,
        )
        by_surface = sorted(
            (
                UsageRow(surface=rows[0].surface, totals=totals_of(rows))
                for rows in bucket(events, lambda event: (event.surface,))
            ),
            key=lambda row: row.totals.total_tokens,
            reverse=True,
        )
        by_source = [
            UsageRow(source=rows[0].source, totals=totals_of(rows))
            for rows in bucket(events, lambda event: (event.source,))
        ]
        # Streaks and the contribution graph span the whole history, not just
        # the requested window. A year of daily buckets is plenty for the graph.
        all_events = self._storage.list_usage()
        active_dates = {event.created_at.date() for event in all_events}
        return UsageSummary(
            totals=totals_of(events),
            by_provider=by_provider,
            by_surface=by_surface,
            by_source=by_source,
            by_day=days_of(events),
            activity=days_of(all_events)[-365:],
            streak=_streak_from_dates(active_dates, utcnow().date()),
        )

    def _unique_branch_name(self, base: str) -> str:
        """A valid branch name derived from `base`, suffixed if taken."""
        slug = "".join(c if c.isalnum() or c in "-_." else "-" for c in base).strip(".-_")
        if not slug:
            slug = "session"
        candidate = slug
        suffix = 2
        while self._branch_exists(candidate):
            candidate = f"{slug}-{suffix}"
            suffix += 1
        return candidate

    # ---------- branches ----------

    def branch(self, name: str, from_commit: str | None = None) -> Branch:
        """Create a branch pointing at `from_commit` (default: current head)."""
        self._check_ref_name(name)
        if from_commit is None:
            head_id = self._storage.get_branch(self._storage.get_current_branch()).head_commit_id
        elif self._storage.has_commit(from_commit):
            head_id = from_commit
        else:
            raise CommitNotFound(f"commit {from_commit[:12]} not found")
        branch = Branch(name=name, head_commit_id=head_id)
        self._storage.insert_branch(branch)
        return branch

    def checkout(self, name_or_id: str) -> str:
        """Switch HEAD to a branch, or to a commit (detached: updates main's
        pointer only via `commit(branch=...)`; returns the resolved ref)."""
        if self._branch_exists(name_or_id) and not self._storage.branch_is_trashed(name_or_id):
            self._storage.set_current_branch(name_or_id)
            return name_or_id
        if self._storage.has_commit(name_or_id):
            # Detached-head equivalent: keep HEAD on main; callers use
            # commit(branch=...) or branch(...) to fork from this commit.
            return name_or_id
        raise BranchNotFound(f"no branch or commit '{name_or_id[:12]}'")

    def delete_branch(self, name: str) -> None:
        """Move a branch to Storage (trash). Commits are never deleted."""
        if name == self._storage.get_current_branch():
            raise InvalidRefName("cannot delete the current branch")
        self._storage.soft_delete_branch(name, utcnow().isoformat())

    def restore_branch(self, name: str) -> Branch:
        """Bring a trashed branch back into the normal listings.

        A conversation's chat session is restored with it, so the pair comes back
        whole (a run's branch is normally not trashed, so this is a no-op there).
        """
        self._storage.restore_branch(name)
        for session in self._storage.list_trashed_sessions():
            if session.branch == name:
                session.deleted_at = None
                session.updated_at = utcnow()
                self._storage.update_session(session)
        return self._storage.get_branch(name)

    def purge_branch(self, name: str) -> None:
        """Permanently drop a branch pointer. Commits are never deleted."""
        if name == self._storage.get_current_branch():
            raise InvalidRefName("cannot purge the current branch")
        self._storage.delete_branch(name)

    def get_branch(self, name: str) -> Branch:
        """Return one branch pointer by name."""
        return self._storage.get_branch(name)

    def list_branches(self) -> list[Branch]:
        return self._storage.list_branches()

    def list_trashed_branches(self) -> list[Branch]:
        """Branches currently in Storage (trash)."""
        return self._storage.list_trashed_branches()

    def current_branch(self) -> str:
        return self._storage.get_current_branch()

    # ---------- tags ----------

    def tag(self, name: str, commit_id: str | None = None, label: str | None = None) -> Tag:
        """Label a commit, e.g. a known-good state."""
        self._check_ref_name(name)
        current = self._storage.get_branch(self._storage.get_current_branch()).head_commit_id
        cid = commit_id or current
        if not self._storage.has_commit(cid):
            raise CommitNotFound(f"commit {cid[:12]} not found")
        tag = Tag(name=name, commit_id=cid, label=label)
        self._storage.insert_tag(tag)
        return tag

    def list_tags(self) -> list[Tag]:
        return self._storage.list_tags()

    # ---------- helpers ----------

    def _branch_exists(self, name: str) -> bool:
        try:
            self._storage.get_branch(name)
            return True
        except BranchNotFound:
            return False

    # ---------- providers (locally stored LLM endpoints) ----------

    def list_providers(self) -> list[ProviderRecord]:
        """Every user-configured provider row (built-ins live in llm/spec.py)."""
        return self._storage.list_provider_rows()

    def get_provider(self, provider_id: str) -> ProviderRecord | None:
        """One stored provider row, or None when only the built-in is defined."""
        return self._storage.get_provider_row(provider_id)

    def save_provider(self, record: ProviderRecord) -> ProviderRecord:
        """Insert or update a provider row (used by the add-a-provider flow)."""
        return self._storage.upsert_provider(record)

    def delete_provider(self, provider_id: str) -> bool:
        """Remove a stored provider row; a built-in reverts to unconfigured."""
        return self._storage.delete_provider_row(provider_id)

    def list_agent_providers(self) -> list[ProviderRecord]:
        """The asset agent's provider rows (a store separate from Chat's)."""
        return self._storage.list_agent_provider_rows()

    def get_agent_provider(self, provider_id: str) -> ProviderRecord | None:
        """One stored asset-agent provider row, or None."""
        return self._storage.get_agent_provider_row(provider_id)

    def save_agent_provider(self, record: ProviderRecord) -> ProviderRecord:
        """Insert or update an asset-agent provider row."""
        return self._storage.upsert_agent_provider(record)

    def delete_agent_provider(self, provider_id: str) -> bool:
        """Remove an asset-agent provider row."""
        return self._storage.delete_agent_provider_row(provider_id)

    # ---------- scheduled repository issues ----------

    def issue_config(self) -> IssueScanConfig:
        return self._storage.get_issue_config()

    def save_issue_config(self, config: IssueScanConfig) -> IssueScanConfig:
        self._storage.save_issue_config(config)
        return config

    def issue_runs(self, limit: int = 50) -> list[IssueScanRun]:
        return self._storage.list_issue_runs(limit)

    def issue_findings(self, limit: int = 500) -> list[IssueFinding]:
        return self._storage.list_issue_findings(limit)

    def save_issue_run(self, run: IssueScanRun) -> None:
        self._storage.update_issue_run(run)

    def create_issue_run(self, run: IssueScanRun) -> None:
        self._storage.insert_issue_run(run)

    def save_issue_finding(self, finding: IssueFinding) -> None:
        self._storage.insert_issue_finding(finding)

    def issue_link(self, fingerprint: str) -> IssueLink | None:
        return self._storage.get_issue_link(fingerprint)

    def save_issue_link(self, link: IssueLink) -> None:
        self._storage.save_issue_link(link)

    # ---------- versioned repository agent ----------

    def create_agent_run(self, run: AgentRun) -> None:
        self._storage.insert_agent_run(run)

    def save_agent_run(self, run: AgentRun) -> None:
        self._storage.update_agent_run(run)

    def agent_run(self, run_id: str) -> AgentRun:
        run = self._storage.get_agent_run(run_id)
        if run is None:
            raise SessionNotFound(f"agent run '{run_id}' not found")
        return run

    def agent_runs(self, limit: int = 50) -> list[AgentRun]:
        return self._storage.list_agent_runs(limit)

    def save_agent_step(self, step: AgentStep) -> None:
        self._storage.insert_agent_step(step)

    def update_agent_step(self, step: AgentStep) -> None:
        self._storage.update_agent_step(step)

    def agent_steps(self, run_id: str) -> list[AgentStep]:
        return self._storage.list_agent_steps(run_id)

    def save_agent_approval(self, approval: AgentApproval) -> None:
        self._storage.insert_agent_approval(approval)

    def save_agent_artifact(self, artifact: AgentArtifact) -> None:
        self._storage.insert_agent_artifact(artifact)

    def agent_artifacts(self, run_id: str) -> list[AgentArtifact]:
        return self._storage.list_agent_artifacts(run_id)

    def create_local_issue(self, issue: LocalIssue) -> None:
        self._storage.insert_local_issue(issue)

    def local_issue(self, issue_id: str) -> LocalIssue | None:
        return self._storage.get_local_issue(issue_id)

    def local_issues(self, limit: int = 100) -> list[LocalIssue]:
        return self._storage.list_local_issues(limit)

    # ---------- HTTP / API client ----------

    def record_http_history(
        self, method: str, url: str, status: int, elapsed_ms: int, size: int
    ) -> None:
        """Remember one executed request (the API tab's history)."""
        self._storage.record_http_history(method, url, status, elapsed_ms, size)

    def list_http_history(self, limit: int = 50) -> list[HttpHistoryEntry]:
        """Recent executed requests, newest first."""
        return [
            HttpHistoryEntry(
                id=row["id"],
                method=row["method"],
                url=row["url"],
                status=row["status"],
                elapsed_ms=row["elapsed_ms"],
                size=row["size"],
                created_at=row["created_at"],
            )
            for row in self._storage.list_http_history(limit)
        ]

    @staticmethod
    def _check_ref_name(name: str) -> None:
        forbidden = " \t\n~^:?*[\\"
        bad = (
            not name
            or any(c in forbidden for c in name)
            or name.startswith("-")
            or name.endswith(".")
            or ".." in name
            or "@{" in name
            or "//" in name
            or name.endswith(".lock")
        )
        if bad:
            raise InvalidRefName(f"invalid ref name: {name!r}")

    def count_tokens(self, commit_id: str, model: str) -> int:
        """Token count for the context at a commit.

        Phase 1 estimate: ~4 chars per token, the standard rough heuristic.
        The LLM adapter replaces this with provider counts in Phase 2.
        """
        text = "\n".join(m.content for m in self.build_context(commit_id))
        return max(1, (len(text) + 3) // 4) if text else 0

    @staticmethod
    def root_parent() -> str:
        """The distinguished parent id used in the demo canonical form."""
        return _ROOT_PARENT
