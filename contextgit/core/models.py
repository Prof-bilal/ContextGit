"""Pydantic models for everything crossing a boundary (storage, API, CLI output).

Implements the data model in docs: Message, Commit (immutable), Branch,
Tag. Only fields listed there are tracked; hashing covers the canonical
subset defined in hashing.py.
"""

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field

Role = Literal["system", "user", "assistant", "tool"]
CommitKind = Literal["normal", "merge", "note", "root"]


def utcnow() -> datetime:
    """Current UTC time, timezone-aware."""
    return datetime.now(UTC)


class Message(BaseModel):
    """One message added in a commit."""

    role: Role
    content: str
    created_at: datetime = Field(default_factory=utcnow)


class Commit(BaseModel):
    """An immutable, content-addressed set of messages.

    `id` is the SHA-256 of the canonical JSON of (parent_ids, messages,
    metadata.kind, metadata.model) — see core/hashing.py. Never edit a
    commit; create a new one.
    """

    id: str
    parent_ids: list[str]
    messages: list[Message]
    kind: CommitKind
    model: str
    summary: str | None = None
    token_count: int = 0
    author: str | None = None
    created_at: datetime = Field(default_factory=utcnow)


class Branch(BaseModel):
    """A mutable pointer to a commit."""

    name: str
    head_commit_id: str


class Tag(BaseModel):
    """A named label on a commit, e.g. 'known-good'."""

    name: str
    commit_id: str
    label: str | None = None


SessionKind = Literal["chat", "terminal"]
SessionStatus = Literal["idle", "running", "done", "error"]
MergeStatus = Literal["queued", "merged", "blocked", "failed"]


class Session(BaseModel):
    """One AI run bound to a branch, with its own staging buffer.

    Sessions are mutable pointers (like branches): status and name change,
    the staged messages accumulate until the user commits them.
    """

    id: str
    name: str
    kind: SessionKind
    branch: str
    status: SessionStatus = "idle"
    agent: str | None = None
    auto_commit: bool = False
    # Worktree pairing: the git checkout (code) that goes with `branch` (conversation).
    # All None/empty for non-git projects, which share one workspace folder.
    worktree_path: str | None = None
    git_branch: str | None = None
    base_ref: str | None = None
    base_commit: str | None = None
    task: str | None = None
    scope: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class MergeQueueEntry(BaseModel):
    """A run waiting to merge into a target branch, in queue order."""

    id: int
    session_id: str
    target: str
    position: int
    status: MergeStatus = "queued"
    conflicts: list[str] = Field(default_factory=list)
    commit_id: str | None = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
