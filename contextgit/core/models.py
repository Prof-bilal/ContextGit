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
    # When set, the branch is in Storage (trash): hidden from the normal lists
    # but recoverable. None means live.
    deleted_at: datetime | None = None


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


# ---------- scheduled repository issues ----------

IssueSeverity = Literal["critical", "high", "medium", "low"]
IssueScanner = Literal["secrets", "dependencies", "quality", "review"]
IssueRunStatus = Literal["queued", "running", "done", "failed"]
IssueTrigger = Literal["manual", "schedule", "github_actions"]


def _default_issue_scanners() -> list[IssueScanner]:
    return ["secrets", "dependencies", "quality", "review"]


class IssueScanConfig(BaseModel):
    enabled: bool = False
    timezone: str = "UTC"
    interval_hours: int = 5
    schedule_minute: int = 17
    scanners: list[IssueScanner] = Field(default_factory=_default_issue_scanners)
    minimum_severity: IssueSeverity = "high"
    minimum_confidence: float = 0.9
    auto_create: bool = False
    github_repository: str | None = None
    next_run_at: datetime | None = None
    updated_at: datetime = Field(default_factory=utcnow)


class IssueScanRun(BaseModel):
    id: str
    commit_sha: str | None = None
    trigger: IssueTrigger = "manual"
    status: IssueRunStatus = "queued"
    started_at: datetime = Field(default_factory=utcnow)
    finished_at: datetime | None = None
    counts: dict[str, int] = Field(default_factory=dict)
    steps: list[dict[str, object]] = Field(default_factory=list)
    error: str | None = None


class IssueFinding(BaseModel):
    id: str
    run_id: str
    fingerprint: str
    scanner: IssueScanner
    rule_id: str
    severity: IssueSeverity
    confidence: float = 1.0
    title: str
    location: str | None = None
    evidence: str = ""
    why: str = ""
    fix: str = ""
    status: Literal["open", "resolved"] = "open"
    created_at: datetime = Field(default_factory=utcnow)


class IssueLink(BaseModel):
    fingerprint: str
    provider: Literal["github"] = "github"
    issue_number: int
    issue_url: str
    state: str = "open"
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


AgentRunStatus = Literal[
    "queued",
    "inspecting",
    "planning",
    "awaiting_approval",
    "executing",
    "validating",
    "ready",
    "completed",
    "failed",
    "cancelled",
]
AgentStepStatus = Literal["queued", "running", "done", "failed", "rejected"]
LocalIssueStatus = Literal["open", "in-progress", "resolved", "dismissed"]
LocalIssueSource = Literal["user", "scan", "agent", "validation"]


class AgentRun(BaseModel):
    id: str
    session_id: str
    task: str
    provider: str | None = None
    model: str | None = None
    base_commit: str | None = None
    worktree_path: str | None = None
    status: AgentRunStatus = "queued"
    plan: dict[str, object] | None = None
    resulting_commit: str | None = None
    local_issue_id: str | None = None
    error: str | None = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class AgentStep(BaseModel):
    id: str
    run_id: str
    sequence: int
    kind: str
    status: AgentStepStatus = "queued"
    input_summary: str = ""
    output_summary: str = ""
    files: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utcnow)


class AgentApproval(BaseModel):
    id: str
    run_id: str
    step_id: str
    approval_type: Literal["plan", "edit", "command", "commit", "issue"]
    action: str
    decision: Literal["pending", "approved", "rejected"] = "pending"
    created_at: datetime = Field(default_factory=utcnow)


class AgentArtifact(BaseModel):
    id: str
    run_id: str
    kind: Literal["plan", "diff", "check", "summary", "issue"]
    content: str
    created_at: datetime = Field(default_factory=utcnow)


class LocalIssue(BaseModel):
    id: str
    title: str
    body: str
    status: LocalIssueStatus = "open"
    labels: list[str] = Field(default_factory=list)
    source: LocalIssueSource = "agent"
    agent_run_id: str | None = None
    commit_id: str | None = None
    branch: str | None = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


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
    # The project folder this run belongs to (its worktree lives under it). Set
    # for every run so the UI can group runs by project, git or not.
    project_path: str | None = None
    task: str | None = None
    scope: list[str] = Field(default_factory=list)
    # The role this run plays and the skills auto-loaded for it (human-readable
    # labels resolved from the desktop catalog). Both optional and best-effort.
    role: str | None = None
    skills: list[str] = Field(default_factory=list)
    # A stable local port for this run, so two runs' dev servers cannot collide.
    port: int | None = None
    # When set, the run is in Storage (trash): hidden from normal lists but
    # recoverable. None means live.
    deleted_at: datetime | None = None
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


# ---------- HTTP / API client (the API tab) ----------

HttpBodyKind = Literal["none", "json", "text", "form"]
HttpAuthKind = Literal["none", "bearer", "basic", "api-key", "cookie"]


class HttpKeyValue(BaseModel):
    """One enabled/disabled query param or header row."""

    name: str = ""
    value: str = ""
    enabled: bool = True


class HttpRequestSpec(BaseModel):
    """A request the user composed: method, URL, params, headers, body, auth."""

    method: str = "GET"
    url: str = ""
    params: list[HttpKeyValue] = Field(default_factory=list)
    headers: list[HttpKeyValue] = Field(default_factory=list)
    body_kind: HttpBodyKind = "none"
    body: str = ""
    auth_kind: HttpAuthKind = "none"
    auth_value: str = ""
    timeout_s: float = 30.0
    verify_tls: bool = True
    follow_redirects: bool = True


class HttpResponseResult(BaseModel):
    """What came back: status, headers, body (capped), timing and size."""

    status: int
    reason: str = ""
    headers: dict[str, str] = Field(default_factory=dict)
    body: str = ""
    truncated: bool = False
    elapsed_ms: int = 0
    size: int = 0
    url: str = ""


class HttpSavedRequest(BaseModel):
    """A named request inside a collection."""

    name: str
    spec: HttpRequestSpec


class HttpCollection(BaseModel):
    """A collection of saved requests, stored as a file in the repo."""

    name: str
    requests: list[HttpSavedRequest] = Field(default_factory=list)


class HttpHistoryEntry(BaseModel):
    """One executed request, for the history list."""

    id: int
    method: str
    url: str
    status: int
    elapsed_ms: int
    size: int
    created_at: datetime = Field(default_factory=utcnow)


# ---------- endpoint graph (the Endpoints tab) ----------

EndpointSourceKind = Literal["openapi", "python", "django", "javascript", "go", "manual"]
Confidence = Literal["high", "medium", "low"]
EndpointFieldLocation = Literal["path", "query", "header", "cookie", "body"]


class EndpointSource(BaseModel):
    """Where an endpoint was found, and how much to trust that finding."""

    kind: EndpointSourceKind
    file: str | None = None
    line: int | None = None
    line_end: int | None = None
    confidence: Confidence = "medium"


class EndpointField(BaseModel):
    """One input the endpoint accepts."""

    name: str
    location: EndpointFieldLocation
    type: str | None = None
    required: bool = False


class EndpointProvenance(BaseModel):
    """Which change produced this endpoint — the join to the context graph.

    `tracked` is False when the code change did not come from a recorded run; in
    that case only the git commit is reported, and no run is invented.
    """

    tracked: bool = False
    code_commit: str | None = None
    code_commit_summary: str | None = None
    author: str | None = None
    committed_at: datetime | None = None
    run_id: str | None = None
    run_name: str | None = None
    agent: str | None = None
    model: str | None = None
    context_commit: str | None = None
    context_branch: str | None = None
    summary: str | None = None
    excerpt: str | None = None
    decisions: list[str] = Field(default_factory=list)
    dead_ends: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)


class Endpoint(BaseModel):
    """One HTTP endpoint of the user's project, with its origin."""

    id: str
    method: str
    path: str
    operation: str | None = None
    tags: list[str] = Field(default_factory=list)
    auth: bool = False
    request_fields: list[EndpointField] = Field(default_factory=list)
    response_status: int | None = None
    source: EndpointSource
    provenance: EndpointProvenance | None = None


class EndpointGraph(BaseModel):
    """What the Endpoints tab shows for one project."""

    project_path: str
    generated_at: datetime = Field(default_factory=utcnow)
    scanned_files: int = 0
    endpoints: list[Endpoint] = Field(default_factory=list)


RunCommandSource = Literal[
    "env", "package.json", "make", "django", "uvicorn", "flask", "go", "rust"
]


class RunCommand(BaseModel):
    """How we think this project's server starts."""

    command: str
    cwd: str
    source: RunCommandSource
    port: int | None = None


class ServerStatus(BaseModel):
    """The project's running server, as the UI shows it."""

    running: bool = False
    healthy: bool = False
    command: str | None = None
    cwd: str | None = None
    port: int | None = None
    url: str | None = None
    started_at: datetime | None = None
    exit_code: int | None = None
    error: str | None = None
    log: list[str] = Field(default_factory=list)
    detected: RunCommand | None = None


TestStatus = Literal["untested", "pass", "fail"]
# Whether a generated test still describes the endpoint it was written for.
TestState = Literal["untested", "fresh", "stale", "retired"]


class EndpointTestFile(BaseModel):
    """One generated test file: where it lands, how it last ran, and whether it
    still describes the endpoint it was written for."""

    endpoint_id: str
    file: str
    handler: str | None = None
    tests: list[str] = Field(default_factory=list)
    status: TestStatus = "untested"
    detail: str | None = None
    ran_at: datetime | None = None
    verified_at_commit: str | None = None
    state: TestState = "untested"
    reason: str | None = None


class EndpointTestSuite(BaseModel):
    """The project's generated API tests, and the latest run."""

    project_path: str
    files: list[EndpointTestFile] = Field(default_factory=list)
    passed: int = 0
    failed: int = 0
    stale: int = 0
    retired: int = 0
    output: str | None = None


# ---------- rationale blame (the Why lens) ----------


class WhyFinding(BaseModel):
    """One change that shaped a file or line, with the reasoning behind it."""

    code_commit: str | None = None
    summary: str | None = None
    author: str | None = None
    committed_at: datetime | None = None
    tracked: bool = False
    run_id: str | None = None
    run_name: str | None = None
    agent: str | None = None
    model: str | None = None
    context_branch: str | None = None
    excerpt: str | None = None
    decisions: list[str] = Field(default_factory=list)
    dead_ends: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    facts: list[str] = Field(default_factory=list)


class WhyAnswer(BaseModel):
    """Why a path — and optionally a line — exists, as of a point in history."""

    path: str
    line: int | None = None
    as_of: str | None = None
    reasoned: bool = False
    cached: bool = False
    note: str | None = None
    findings: list[WhyFinding] = Field(default_factory=list)


# ---------- scoped memory (what an agent should know before it edits) ----------


class MemoryRun(BaseModel):
    """One past run whose reasoning still governs the paths in scope."""

    run_id: str
    run_name: str | None = None
    agent: str | None = None
    model: str | None = None
    files: list[str] = Field(default_factory=list)
    decisions: list[str] = Field(default_factory=list)
    dead_ends: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)


class MemoryBundle(BaseModel):
    """The derived, versioned memory for a set of paths — never hand-written."""

    project_path: str
    scoped_by: str | None = None
    paths: list[str] = Field(default_factory=list)
    files: list[str] = Field(default_factory=list)
    runs: list[MemoryRun] = Field(default_factory=list)
    decisions: list[str] = Field(default_factory=list)
    dead_ends: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    note: str | None = None


# ---------- database client (the DB tab) ----------

DbEngine = Literal["sqlite", "postgres", "sqlserver"]


class DbConnectionSpec(BaseModel):
    """How to reach one database. Never carries a password."""

    name: str
    engine: DbEngine = "postgres"
    path: str | None = None
    host: str | None = None
    port: int | None = None
    database: str | None = None
    user: str | None = None
    ssl: bool = True
    readonly: bool = True


class DbConnectionInfo(BaseModel):
    """A live connection, as the UI sees it."""

    id: str
    name: str
    engine: DbEngine
    server_version: str | None = None
    database: str | None = None
    readonly: bool = True


class DbColumn(BaseModel):
    """One column of a table."""

    name: str
    type: str | None = None
    nullable: bool = True


class DbTable(BaseModel):
    """One table (or view) and its columns."""

    schema_name: str | None = None
    name: str
    kind: Literal["table", "view"] = "table"
    columns: list[DbColumn] = Field(default_factory=list)


class DbQueryResult(BaseModel):
    """What a query produced: columns, rows, timing, and whether it was capped."""

    columns: list[str] = Field(default_factory=list)
    rows: list[list[str | None]] = Field(default_factory=list)
    row_count: int = 0
    truncated: bool = False
    elapsed_ms: int = 0
    statement: str = ""


class EnvEntry(BaseModel):
    """One environment variable a run had — the name and a hash, never the value."""

    key: str
    hash: str
    source: str


EnvChange = Literal["added", "removed", "changed"]


class EnvDrift(BaseModel):
    """How one variable differs between two runs."""

    key: str
    change: EnvChange
    before: str | None = None
    after: str | None = None


class BisectStep(BaseModel):
    """One probe: a commit, and whether the gate passed there."""

    commit: str
    summary: str | None = None
    ok: bool


class BisectResult(BaseModel):
    """The change that broke behaviour, with the reasoning behind it."""

    project_path: str
    command: str
    good: str
    bad: str
    culprit: str | None = None
    culprit_summary: str | None = None
    steps: list[BisectStep] = Field(default_factory=list)
    probes: int = 0
    note: str | None = None
    log: str | None = None
    run_id: str | None = None
    run_name: str | None = None
    decisions: list[str] = Field(default_factory=list)
    dead_ends: list[str] = Field(default_factory=list)
    env_drift: list[EnvDrift] = Field(default_factory=list)
