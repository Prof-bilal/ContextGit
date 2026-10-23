"""Pydantic schemas for the v1 HTTP API."""

from typing import Literal

from pydantic import BaseModel, Field

from contextgit.core.models import (
    Branch,
    Commit,
    DbConnectionSpec,
    EndpointTestFile,
    EndpointTestSuite,
    Message,
    ProjectMemoryRevision,
    Tag,
)
from contextgit.merge.models import MergePreview


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


class AgentRunRequest(BaseModel):
    task: str = Field(min_length=1, max_length=20_000)
    provider: str | None = None
    model: str | None = None


class AgentApprovalRequest(BaseModel):
    decision: Literal["approved", "rejected"]


class AgentCommitRequest(BaseModel):
    message: str | None = Field(default=None, max_length=240)


class LocalIssueRequest(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    body: str = Field(min_length=1, max_length=20_000)


class IssueConfigRequest(BaseModel):
    enabled: bool | None = None
    timezone: str | None = None
    interval_hours: int | None = Field(default=None, ge=1, le=24)
    schedule_minute: int | None = Field(default=None, ge=1, le=59)
    scanners: list[Literal["secrets", "dependencies", "quality", "review"]] | None = None
    minimum_severity: Literal["critical", "high", "medium", "low"] | None = None
    minimum_confidence: float | None = Field(default=None, ge=0, le=1)
    auto_create: bool | None = None
    github_repository: str | None = None


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


class SessionRequest(BaseModel):
    """Create a session (one AI run bound to a branch)."""

    name: str = Field(min_length=1)
    kind: Literal["chat", "terminal"] = "chat"
    branch: str | None = None
    agent: str | None = None
    model: str | None = Field(default=None, max_length=200)
    auto_commit: bool = False
    from_commit: str | None = None
    # Worktree pairing: give this run its own git checkout in `project_path`.
    project_path: str | None = None
    worktree: bool = False
    base_ref: str | None = None  # fresh | head | a branch name
    task: str | None = None
    scope: list[str] = Field(default_factory=list)
    # The role this run plays and the skills auto-loaded for it (labels).
    role: str | None = None
    skills: list[str] = Field(default_factory=list)
    category: str = Field(default="", max_length=80)


class SessionUpdateRequest(BaseModel):
    """Mutable session fields; None means 'leave unchanged'."""

    name: str | None = None
    status: Literal["idle", "running", "done", "error"] | None = None
    auto_commit: bool | None = None


class ProjectMemorySynthesisRequest(BaseModel):
    project_path: str
    session_ids: list[str] | None = None
    provider: str | None = None
    model: str | None = None


class ProjectMemoryApprovalRequest(BaseModel):
    memory: ProjectMemoryRevision


class StageRequest(BaseModel):
    """Messages to append to a session's staging buffer."""

    messages: list[Message] = Field(min_length=1)


class TerminalTranscriptRequest(BaseModel):
    content: str = Field(min_length=1, max_length=100_000)


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


class TeamCreateRequest(BaseModel):
    """Create the team (mission) that tasks hang off."""

    name: str = Field(min_length=1)
    project_path: str = Field(min_length=1)
    base_ref: str | None = None
    gate_command: str | None = None
    goal: str = ""
    orchestrator_agent: str | None = None
    managed_execution: bool = False
    max_active: int = Field(default=4, ge=1, le=12)
    allowed_agents: list[Literal["codex", "claude", "opencode", "commandcode"]] = Field(default_factory=lambda: ["codex", "claude"], min_length=1)
    orchestrator_model: str | None = Field(default=None, max_length=200)
    worker_models: dict[str, str] = Field(default_factory=dict)


class TeamUpdateRequest(BaseModel):
    name: str | None = None
    goal: str | None = None
    state: (
        Literal[
            "draft",
            "planning",
            "ready",
            "running",
            "paused",
            "review",
            "merge_ready",
            "completed",
            "failed",
        ]
        | None
    ) = None
    orchestrator_agent: str | None = None
    orchestrator_session_id: str | None = None


class TeamPlanRequest(BaseModel):
    goal: str = ""
    tasks: list[dict[str, object]] = Field(default_factory=list, max_length=12)
    completion_criteria: list[str] = Field(default_factory=list)
    quality_gates: list[str] = Field(default_factory=list)


class CanvasViewportRequest(BaseModel):
    project_path: str = Field(min_length=1)
    x: float
    y: float
    zoom: float = Field(ge=0.18, le=1.35)


class CanvasLayoutRequest(BaseModel):
    x: float | None = None
    y: float | None = None
    width: float | None = Field(default=None, ge=420, le=2400)
    height: float | None = Field(default=None, ge=180, le=1800)
    collapsed: bool | None = None
    z_index: int | None = None


class SkillLinkRequest(BaseModel):
    skill_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    instruction: str = Field(min_length=1)
    origin: Literal["built-in", "project", "global"] = "project"
    task_id: str | None = None
    agent: str | None = None


class SkillReviewRequest(BaseModel):
    action: Literal["approve", "reject", "remove", "promote"]
    instruction: str | None = Field(default=None, min_length=1, max_length=12000)


class GroupWorkersRequest(BaseModel):
    project_path: str
    name: str = Field(min_length=1, max_length=160)
    task_ids: list[str] = Field(min_length=1, max_length=12)


class ReorderWorkersRequest(BaseModel):
    task_ids: list[str] = Field(max_length=12)


class TeamGateRequest(BaseModel):
    """Set the team's default quality gate command (empty clears it)."""

    gate_command: str | None = None


class TaskCreateRequest(BaseModel):
    """Add one task to the team graph."""

    title: str = Field(min_length=1)
    brief: str = ""
    done_criteria: str = ""
    role: str = "implementer"
    agent: str | None = None
    scope: list[str] = Field(default_factory=list)
    contract: str | None = None
    depends_on: list[str] = Field(default_factory=list)
    gate_command: str | None = None
    parent_id: str | None = None


class TaskStartRequest(BaseModel):
    """Optionally choose the provider when starting a task."""

    agent: str | None = None


class TaskStopRequest(BaseModel):
    """Stop a running task and explain why."""

    note: str = "stopped by user"


class TaskUpdateRequest(BaseModel):
    """Mutable task fields; None means 'leave unchanged'."""

    title: str | None = None
    brief: str | None = None
    done_criteria: str | None = None
    role: str | None = None
    agent: str | None = None
    scope: list[str] | None = None
    contract: str | None = None
    status: Literal["todo", "blocked", "working", "review", "failed"] | None = None
    depends_on: list[str] | None = None
    gate_command: str | None = None


class TaskRejectRequest(BaseModel):
    """Send a reviewed task back with the changes the implementer must make."""

    note: str = Field(min_length=1)


class TaskVerifyRequest(BaseModel):
    """Start a read-only verifier run, optionally with a named agent."""

    agent: str | None = None


class TeamMessageRequest(BaseModel):
    """Post a line to the team board feed."""

    body: str = Field(min_length=1)
    kind: Literal[
        "update", "question", "answer", "handoff", "contract", "review", "gate", "system"
    ] = "update"
    task_id: str | None = None
    from_task_id: str | None = None


class EndpointServeRequest(BaseModel):
    """Start the project's server (with an optional command override)."""

    project_path: str
    command: str | None = None
    port: int | None = None


class EndpointGenerateRequest(BaseModel):
    """Write tests for one endpoint, using a chat provider to author them."""

    project_path: str
    endpoint_id: str
    provider_id: str = "openai"
    model: str | None = None


class EndpointRunRequest(BaseModel):
    """Run the generated API tests against a base URL."""

    project_path: str
    base_url: str | None = None


class EndpointGenerateResponse(BaseModel):
    """The endpoint's new test file, plus the suite it now belongs to."""

    file: EndpointTestFile
    suite: EndpointTestSuite
    overwrote: bool = False
    failure: str | None = None


class EndpointBisectRequest(BaseModel):
    """Find the change that broke behaviour, between a good and a bad commit."""

    project_path: str
    endpoint_id: str | None = None
    good: str | None = None
    bad: str | None = None
    command: str | None = None
    provider_id: str | None = None


class DbOpenRequest(BaseModel):
    """Open a connection. The password travels with this request and is stored nowhere."""

    spec: DbConnectionSpec
    password: str | None = None


class DbQueryRequest(BaseModel):
    """Run one statement on an open connection."""

    connection_id: str
    sql: str = Field(min_length=1)
    limit: int | None = None
