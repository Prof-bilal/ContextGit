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


class BlameEntry(BaseModel):
    """Provenance for one context message: the commit that introduced it."""

    index: int
    role: Role
    content: str
    commit_id: str
    kind: CommitKind
    model: str
    summary: str | None = None
    author: str | None = None
    created_at: datetime = Field(default_factory=utcnow)


SessionKind = Literal["chat", "terminal"]
SessionStatus = Literal["idle", "running", "done", "error"]
MergeStatus = Literal["queued", "merged", "blocked", "failed"]

# How a provider expects its key: Bearer header, x-api-key, Azure's api-key,
# a `?key=` query param, or no auth at all (local servers).
ProviderKind = Literal["cloud", "gateway", "local", "mock"]
AuthStyle = Literal["bearer", "x-api-key", "api-key", "query", "none"]
# What a provider is for: chat completions, web search, or image generation.
ProviderCapability = Literal["chat", "search", "image"]


class ProviderRecord(BaseModel):
    """A user-configured provider, stored locally (never leaves the machine).

    Built-in providers come from `contextgit.llm.spec`; a row here either
    overrides a built-in (e.g. supplies its key) or adds a custom endpoint.
    `api_key` lives only in storage and is redacted before it crosses the API.
    """

    id: str
    label: str
    vendor: str = ""
    kind: ProviderKind = "cloud"
    capability: ProviderCapability = "chat"
    base_url: str
    auth_style: AuthStyle = "bearer"
    api_key: str | None = None
    default_model: str | None = None
    models: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


# Where an LLM call happened: a chat turn, a council member, a research run, an
# image render, or a committed CLI/PTY turn.
UsageSurface = Literal["chat", "council", "research", "image", "code"]
# 'provider' when the provider reported real usage; 'estimate' for the ~4-chars fallback.
UsageSource = Literal["provider", "estimate"]


class UsageEvent(BaseModel):
    """One recorded LLM call's token usage (real or estimated)."""

    provider: str
    model: str
    surface: UsageSurface
    source: UsageSource
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    session_id: str | None = None
    branch: str | None = None
    created_at: datetime = Field(default_factory=utcnow)


class UsageTotals(BaseModel):
    """Summed token counts over a set of usage events."""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    # How much of `total_tokens` came from estimates rather than real usage.
    estimated_tokens: int = 0
    calls: int = 0


class UsageRow(BaseModel):
    """One grouped bucket of usage (by provider/model, surface, or source)."""

    provider: str | None = None
    model: str | None = None
    surface: UsageSurface | None = None
    source: UsageSource | None = None
    totals: UsageTotals


class UsageDay(BaseModel):
    """One calendar day's usage (UTC), for the trend chart and activity heatmap."""

    date: str  # ISO date, YYYY-MM-DD
    totals: UsageTotals


class UsageStreak(BaseModel):
    """Consecutive-day activity stats, computed over every recorded usage event."""

    # Consecutive active days ending today; yesterday still counts as current.
    current: int = 0
    longest: int = 0
    active_days: int = 0
    last_active: str | None = None  # ISO date


class UsageSummary(BaseModel):
    """Merged usage across every surface, for the Usage tab."""

    totals: UsageTotals
    by_provider: list[UsageRow] = Field(default_factory=list)
    by_surface: list[UsageRow] = Field(default_factory=list)
    by_source: list[UsageRow] = Field(default_factory=list)
    # Daily buckets within the requested window, oldest first.
    by_day: list[UsageDay] = Field(default_factory=list)
    # Daily buckets over the last 365 days, for the contribution graph.
    activity: list[UsageDay] = Field(default_factory=list)
    # All-time streaks (independent of the requested window).
    streak: UsageStreak = Field(default_factory=UsageStreak)


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
    # A stable local port for this run, so two runs' dev servers cannot collide.
    port: int | None = None
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


TaskStatus = Literal["todo", "blocked", "working", "review", "done", "failed"]
TeamMessageKind = Literal[
    "update", "question", "answer", "handoff", "contract", "review", "gate", "system"
]


class Team(BaseModel):
    """One mission: a named set of tasks over a single project folder."""

    id: str
    name: str
    project_path: str
    base_ref: str | None = None
    # The default quality gate command for this team's tasks.
    gate_command: str | None = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class Task(BaseModel):
    """One unit of team work, owned by one run and bounded by a file scope.

    `depends_on` and `blocked_by` are derived from `task_deps` by `Repo`
    (never stored on the row): `blocked_by` lists dependencies that are not
    `done` yet, so an empty `blocked_by` means the task is ready to start.
    """

    id: str
    team_id: str
    title: str
    brief: str = ""
    done_criteria: str = ""
    role: str = "implementer"
    status: TaskStatus = "todo"
    agent: str | None = None
    session_id: str | None = None
    scope: list[str] = Field(default_factory=list)
    contract: str | None = None
    position: int = 0
    depends_on: list[str] = Field(default_factory=list)
    blocked_by: list[str] = Field(default_factory=list)
    # Quality gate: the project command run in this task's worktree on completion.
    gate_command: str | None = None
    gate_status: Literal["pass", "fail"] | None = None
    gate_exit_code: int | None = None
    gate_output: str | None = None
    gate_ran_at: datetime | None = None
    # Independent review: a read-only run that inspects the task's diff.
    verifier_session_id: str | None = None
    review_note: str | None = None
    # Derived: the committed context size of this task's branch (never stored).
    tokens: int = 0
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class TeamMessage(BaseModel):
    """One line on the team board — how runs talk across their worktrees."""

    id: int
    team_id: str
    task_id: str | None = None
    from_task_id: str | None = None
    kind: TeamMessageKind = "update"
    body: str
    created_at: datetime = Field(default_factory=utcnow)


class TeamEvent(BaseModel):
    """An audit row recording what the coordinator did and why."""

    id: int
    team_id: str
    kind: str
    task_id: str | None = None
    payload: dict[str, object] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utcnow)


class TeamBoard(BaseModel):
    """Read model for the UI: the team, its task graph and the message feed."""

    team: Team
    tasks: list[Task]
    messages: list[TeamMessage]
    current_branch: str
