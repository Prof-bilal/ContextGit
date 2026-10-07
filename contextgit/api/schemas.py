"""Pydantic schemas for the v1 HTTP API."""

from typing import Literal

from pydantic import BaseModel, Field

from contextgit.core.models import (
    AuthStyle,
    Branch,
    Commit,
    DbConnectionSpec,
    EndpointTestFile,
    EndpointTestSuite,
    Message,
    ProviderCapability,
    ProviderKind,
    Tag,
)
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
    model: str | None = None
    # When set, the request resolves this provider from the registry; otherwise
    # the server's default provider is used.
    provider: str | None = None
    session_id: str | None = None
    auto_commit: bool | None = None


class CouncilMember(BaseModel):
    """One model in a council: a provider id plus the model to ask."""

    provider: str = Field(min_length=1)
    model: str | None = None


class CouncilRequest(BaseModel):
    """The same prompt sent to several providers at once."""

    prompt: str = Field(min_length=1)
    members: list[CouncilMember] = Field(min_length=2, max_length=5)
    branch: str | None = None
    commit_id: str | None = None
    session_id: str | None = None
    auto_commit: bool | None = None


class ImageRequest(BaseModel):
    """Render a prompt with an image provider; the prompt is the versioned artifact."""

    prompt: str = Field(min_length=1)
    provider: str = "mock-image"
    model: str | None = None
    aspect: str = "16:9"
    count: int = Field(default=4, ge=1, le=8)
    branch: str | None = None
    commit_id: str | None = None
    session_id: str | None = None
    auto_commit: bool | None = None


class ResearchRequest(BaseModel):
    """One research run: deep, competitive, lead, or a verification pass."""

    mode: Literal["deep", "competitive", "lead", "verify"] = "deep"
    prompt: str = Field(min_length=1)
    provider: str | None = None
    model: str | None = None
    search_provider: str = "mock-search"
    branch: str | None = None
    commit_id: str | None = None
    breadth: int = Field(default=3, ge=1, le=6)
    depth: int = Field(default=2, ge=1, le=4)
    max_pages: int = Field(default=6, ge=1, le=20)
    session_id: str | None = None
    auto_commit: bool | None = None


class DocumentRequest(BaseModel):
    """Generate a document on a topic in a chosen format (Chat "Document" mode)."""

    prompt: str = Field(min_length=1)
    format: Literal["md", "pdf", "docx", "pptx"] = "pdf"
    template: Literal["report", "brief", "proposal"] = "report"
    provider: str | None = None
    model: str | None = None
    branch: str | None = None
    commit_id: str | None = None
    session_id: str | None = None
    auto_commit: bool | None = None


class ProviderUpsertRequest(BaseModel):
    """Add or enable one provider (a built-in by id, or a custom endpoint)."""

    id: str | None = None
    label: str | None = None
    vendor: str | None = None
    kind: ProviderKind | None = None
    capability: ProviderCapability | None = None
    base_url: str | None = None
    auth_style: AuthStyle | None = None
    api_key: str | None = None
    default_model: str | None = None
    models: list[str] = Field(default_factory=list)


class ProviderTestResult(BaseModel):
    """The verdict of one tiny completion against a provider."""

    ok: bool
    latency_ms: int
    model: str | None = None
    error: str | None = None


class ProviderModelsResult(BaseModel):
    """The model catalog for a provider, and whether it came from the wire."""

    models: list[str]
    source: Literal["live", "static"]


class AssetAgentAsset(BaseModel):
    """One asset in the slim catalog sent to the asset agent."""

    id: str
    name: str
    kind: str = "other"
    folder: str = ""
    tags: list[str] = Field(default_factory=list)


class AssetAgentCatalog(BaseModel):
    """The catalog the asset agent sees (no paths, mime or sizes)."""

    assets: list[AssetAgentAsset] = Field(default_factory=list)
    folders: list[str] = Field(default_factory=list)


class AssetAgentRequest(BaseModel):
    """Ask the asset agent for a plan, through one of its own providers."""

    provider_id: str
    model: str | None = None
    instruction: str = Field(min_length=1)
    catalog: AssetAgentCatalog = Field(default_factory=AssetAgentCatalog)


class AssetAgentResponse(BaseModel):
    """The validated plan of actions (rename/move/folder/tag/note/delete)."""

    actions: list[dict[str, object]] = Field(default_factory=list)


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
    # The role this run plays and the skills auto-loaded for it (labels).
    role: str | None = None
    skills: list[str] = Field(default_factory=list)


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


class TeamCreateRequest(BaseModel):
    """Create the team (mission) that tasks hang off."""

    name: str = Field(min_length=1)
    project_path: str = Field(min_length=1)
    base_ref: str | None = None
    gate_command: str | None = None


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


class TaskUpdateRequest(BaseModel):
    """Mutable task fields; None means 'leave unchanged'."""

    title: str | None = None
    brief: str | None = None
    done_criteria: str | None = None
    role: str | None = None
    agent: str | None = None
    scope: list[str] | None = None
    contract: str | None = None
    status: Literal["todo", "blocked", "working", "review", "done", "failed"] | None = None
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
