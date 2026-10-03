"""Repo: the core library API (the contract in backend.md).

All business logic lives here. CLI and API call these methods and nothing
else touches storage. Commits are immutable; branches and HEAD are pointers.
Deleting a branch never deletes commits.
"""

from collections.abc import Iterator
from pathlib import Path
from typing import Literal, cast
from uuid import uuid4

from contextgit.core import hashing
from contextgit.core.errors import (
    BranchNotFound,
    CommitNotFound,
    InvalidMergeResolution,
    InvalidRefName,
    MergeConflict,
    RepoAlreadyExists,
    RepoNotFound,
    StagingEmpty,
    StaleMergePreview,
)
from contextgit.core.models import Branch, Commit, CommitKind, Message, Session, Tag, utcnow
from contextgit.llm.base import LLMProvider
from contextgit.merge.engine import common_ancestor, messages_since
from contextgit.merge.engine import diff as build_diff
from contextgit.merge.models import Diff, MergePreview
from contextgit.merge.semantic import extract_semantics
from contextgit.storage.sqlite import SqliteStorage

_DB_NAME = "contextgit.db"
_ROOT_PARENT = "a3f9c21"


class Repo:
    """A ContextGit repository rooted at a directory."""

    def __init__(self, root: Path | str, storage: SqliteStorage | None = None) -> None:
        self._root = Path(root)
        self._storage = storage or SqliteStorage(self._root / _DB_NAME)

    @property
    def root(self) -> Path:
        return self._root

    @classmethod
    def init(cls, path: Path | str, author: str | None = None) -> "Repo":
        """Create a new repository with a root commit on branch `main`."""
        root = Path(path)
        db = root / _DB_NAME
        if db.exists():
            raise RepoAlreadyExists(f"repository already exists at {root}")
        root.mkdir(parents=True, exist_ok=True)
        storage = SqliteStorage(db)
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
        return cls(Path(path), SqliteStorage(db))

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
        )
        self._storage.insert_commit(commit)
        self._storage.update_branch_head(name, cid)
        return commit

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
        self._storage.update_branch_head(preview.target_branch, cid)
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
    ) -> Session:
        """Create a session bound to a branch (creating the branch if needed).

        Each session owns a staging buffer; messages staged here become one
        commit when the user calls `commit_staged`.
        """
        if kind not in {"chat", "terminal"}:
            raise InvalidRefName(f"unknown session kind: {kind!r}")
        branch_name = branch or self._unique_branch_name(name)
        if not self._branch_exists(branch_name):
            self.branch(branch_name, from_commit=from_commit)
        session = Session(
            id=uuid4().hex,
            name=name,
            kind=cast("Literal['chat', 'terminal']", kind),
            branch=branch_name,
            agent=agent,
            auto_commit=auto_commit,
        )
        self._storage.insert_session(session)
        return session

    def get_session(self, session_id: str) -> Session:
        return self._storage.get_session(session_id)

    def list_sessions(self) -> list[Session]:
        return self._storage.list_sessions()

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

    def delete_session(self, session_id: str) -> None:
        """Delete a session and its staged messages. Commits/branches survive."""
        self._storage.delete_session(session_id)

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
        return commit

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
        if self._branch_exists(name_or_id):
            self._storage.set_current_branch(name_or_id)
            return name_or_id
        if self._storage.has_commit(name_or_id):
            # Detached-head equivalent: keep HEAD on main; callers use
            # commit(branch=...) or branch(...) to fork from this commit.
            return name_or_id
        raise BranchNotFound(f"no branch or commit '{name_or_id[:12]}'")

    def delete_branch(self, name: str) -> None:
        """Delete a branch pointer. Commits are never deleted."""
        if name == self._storage.get_current_branch():
            raise InvalidRefName("cannot delete the current branch")
        self._storage.delete_branch(name)

    def get_branch(self, name: str) -> Branch:
        """Return one branch pointer by name."""
        return self._storage.get_branch(name)

    def list_branches(self) -> list[Branch]:
        return self._storage.list_branches()

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

    @staticmethod
    def _check_ref_name(name: str) -> None:
        forbidden = " \t\n~^:?*[\\"
        bad = (
            not name
            or any(c in forbidden for c in name)
            or name.startswith("-")
            or name.endswith(".")
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
