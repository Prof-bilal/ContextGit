"""Repo: the core library API (the contract in backend.md).

All business logic lives here. CLI and API call these methods and nothing
else touches storage. Commits are immutable; branches and HEAD are pointers.
Deleting a branch never deletes commits.
"""

from collections.abc import Iterator
from pathlib import Path
from typing import cast

from contextgit.core import hashing
from contextgit.core.errors import (
    BranchNotFound,
    CommitNotFound,
    InvalidRefName,
    RepoAlreadyExists,
    RepoNotFound,
)
from contextgit.core.models import Branch, Commit, CommitKind, Message, Tag
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
