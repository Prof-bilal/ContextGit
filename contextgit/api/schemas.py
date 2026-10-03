"""Pydantic schemas for the v1 HTTP API."""

from typing import Literal

from pydantic import BaseModel, Field

from contextgit.core.models import Branch, Commit, Message, Tag
from contextgit.merge.models import Diff, MergePreview


class InitRequest(BaseModel):
    """Initialize a repository directory."""

    path: str
    author: str | None = None


class CommitRequest(BaseModel):
    """Add user and assistant messages to a branch."""

    messages: list[Message] = Field(min_length=1)
    model: str = "none"
    summary: str | None = None
    branch: str | None = None
    author: str | None = None


class BranchRequest(BaseModel):
    """Create a branch at a commit or the current branch head."""

    name: str
    from_commit: str | None = None


class CheckoutRequest(BaseModel):
    """Select a branch or commit."""

    ref: str


class ChatRequest(BaseModel):
    """Prompt and configuration for one streamed chat turn."""

    prompt: str = Field(min_length=1)
    branch: str | None = None
    commit_id: str | None = None
    model: str = "gpt-4o-mini"
    session_id: str | None = None
    auto_commit: bool | None = None


class CompareRequest(BaseModel):
    """Prompt to send to two branches for side-by-side comparison."""

    prompt: str = Field(min_length=1)
    branch_a: str
    branch_b: str
    model: str = "gpt-4o-mini"


class MergePreviewRequest(BaseModel):
    """Create a merge preview without changing repository state."""

    source: str
    into: str | None = None


class MergeApplyRequest(BaseModel):
    """Apply a reviewed merge preview with explicit conflict choices."""

    preview: MergePreview
    resolutions: dict[str, str] = Field(default_factory=dict)
    summary: str | None = None
    author: str | None = None


class CommitResponse(BaseModel):
    """Commit and its reconstructed context metadata."""

    commit: Commit
    token_count: int
    context_message_count: int


class RepoSnapshot(BaseModel):
    """Repository branch heads and commits for graph rendering."""

    current_branch: str
    branches: list[Branch]
    commits: list[Commit]
    tags: list[Tag]


class CompareResult(BaseModel):
    """Answers for both branches."""

    branch_a: str
    branch_b: str
    answer_a: str
    answer_b: str
    model: str
    diff: Diff


class SessionRequest(BaseModel):
    """Create a session (one AI run bound to a branch)."""

    name: str = Field(min_length=1)
    kind: Literal["chat", "terminal"] = "chat"
    branch: str | None = None
    agent: str | None = None
    auto_commit: bool = False
    from_commit: str | None = None
    # Worktree pairing: give this run its own git checkout in `project_path`.
    project_path: str | None = None
    worktree: bool = False
    base_ref: str | None = None  # fresh | head | a branch name
    task: str | None = None
    scope: list[str] = Field(default_factory=list)


class SessionUpdateRequest(BaseModel):
    """Mutable session fields; None means 'leave unchanged'."""

    name: str | None = None
    status: Literal["idle", "running", "done", "error"] | None = None
    auto_commit: bool | None = None


class StageRequest(BaseModel):
    """Messages to append to a session's staging buffer."""

    messages: list[Message] = Field(min_length=1)


class CommitStagedRequest(BaseModel):
    """Commit the staged messages with an optional summary."""

    summary: str | None = None
    model: str | None = None
    author: str | None = None


class PreflightRequest(BaseModel):
    """Ask whether a run's branch can still merge into a target."""

    target: str | None = None


class ClaimCheckRequest(BaseModel):
    """Check a proposed file scope against the runs already claiming files."""

    scope: list[str] = Field(min_length=1)
    session_id: str | None = None


class ClaimCheckResult(BaseModel):
    """Sessions whose claimed files overlap the proposed scope."""

    conflicts: list[str]


class EnqueueMergeRequest(BaseModel):
    """Queue a run's branch for merging into a target."""

    session_id: str = Field(min_length=1)
    target: str | None = None


class RunMergeQueueRequest(BaseModel):
    """Merge the queued runs into a target branch."""

    target: str | None = None


class IntegrateRequest(BaseModel):
    """Merge a run's code and context into their targets, together."""

    target: str | None = None  # ContextGit branch
    git_target: str | None = None  # git branch
