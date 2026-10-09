import { apiRequest, ApiError, requestTimeout, type RequestOptions } from "./apiRequest";
export { ApiError } from "./apiRequest";

export type Role = "system" | "user" | "assistant" | "tool";
export type CommitKind = "root" | "normal" | "merge" | "note";

export interface CaptureState {
  status: string;
  detail?: string;
  binding?: { harness: string; native_id: string; directory: string } | null;
  messages?: Message[];
  candidates?: { id: string; title: string }[];
}

export interface Message {
  role: Role;
  content: string;
  created_at?: string;
}

export interface Commit {
  id: string;
  parent_ids: string[];
  messages: Message[];
  kind: CommitKind;
  model: string;
  summary: string | null;
  token_count: number;
  author: string | null;
  created_at: string;
}

export interface CommitResponse {
  commit: Commit;
  token_count: number;
  context_message_count: number;
}

export interface Branch {
  name: string;
  head_commit_id: string;
  project_path?: string | null;
  /** Set when the branch is in Storage (trash); null/absent means live. */
  deleted_at?: string | null;
}

export interface RepoSnapshot {
  current_branch: string;
  branches: Branch[];
  commits: Commit[];
  tags: Array<{ name: string; commit_id: string; label: string | null }>;
}

export type IssueSeverity = "critical" | "high" | "medium" | "low";
export type IssueScanner = "secrets" | "dependencies" | "quality" | "review";
export interface IssueConfig {
  enabled: boolean;
  timezone: string;
  interval_hours: number;
  schedule_minute: number;
  scanners: IssueScanner[];
  minimum_severity: IssueSeverity;
  minimum_confidence: number;
  auto_create: boolean;
  github_repository: string | null;
  next_run_at: string | null;
  updated_at: string;
}
export interface IssueScanRun {
  id: string;
  commit_sha: string | null;
  trigger: "manual" | "schedule" | "github_actions";
  status: "queued" | "running" | "done" | "failed";
  started_at: string;
  finished_at: string | null;
  counts: Record<string, number>;
  steps?: Array<{ scanner: string; status: string; detail: string; findings: number }>;
  error: string | null;
}
export interface IssueLink {
  fingerprint: string;
  provider: "github";
  issue_number: number;
  issue_url: string;
  state: string;
  created_at: string;
  updated_at: string;
}
export interface IssueFinding {
  id: string;
  run_id: string;
  fingerprint: string;
  scanner: IssueScanner;
  rule_id: string;
  severity: IssueSeverity;
  confidence: number;
  title: string;
  location: string | null;
  evidence: string;
  why: string;
  fix: string;
  status: "open" | "resolved";
  created_at: string;
  issue: IssueLink | null;
}

export type AgentRunStatus = "queued" | "inspecting" | "planning" | "awaiting_approval" | "executing" | "validating" | "ready" | "completed" | "failed" | "cancelled";
export interface AgentStep { id: string; run_id: string; sequence: number; kind: string; status: string; input_summary: string; output_summary: string; files: string[]; created_at: string; }
export interface AgentArtifact { id: string; run_id: string; kind: string; content: string; created_at: string; }
export interface LocalIssue { id: string; title: string; body: string; status: string; labels: string[]; source: string; agent_run_id: string | null; commit_id: string | null; branch: string | null; created_at: string; updated_at: string; }
export interface AgentRun { id: string; session_id: string; task: string; provider: string | null; model: string | null; base_commit: string | null; worktree_path: string | null; status: AgentRunStatus; plan: { summary?: string; steps?: string[]; files?: string[]; checks?: string[]; risks?: string[] } | null; resulting_commit: string | null; local_issue_id: string | null; error: string | null; created_at: string; updated_at: string; steps: AgentStep[]; artifacts: AgentArtifact[]; issue: LocalIssue | null; }

export interface MergeConflict {
  id: string;
  category: "decision" | "fact";
  topic: string;
  source: string;
  target: string;
}

export interface MergePreview {
  source_branch: string;
  target_branch: string;
  source_head_id: string;
  target_head_id: string;
  ancestor_id: string;
  extraction: {
    decisions: string[];
    facts: string[];
    dead_ends: string[];
    open_questions: string[];
    conflicts: MergeConflict[];
    summary: string;
  };
  conflicts: MergeConflict[];
  messages: Message[];
  summary: string;
  summary_confidence: "high" | "low";
  fallback: boolean;
}

export interface Diff {
  ancestor_id: string;
  a_id: string;
  b_id: string;
  a_messages: Message[];
  b_messages: Message[];
  a_token_count: number;
  b_token_count: number;
}

export interface CompareResult {
  branch_a: string;
  branch_b: string;
  answer_a: string;
  answer_b: string;
  model: string;
  diff: Diff;
}

// ---------- providers (the add-a-provider flow) ----------

export type ProviderKind = "cloud" | "gateway" | "local" | "mock";
export type ProviderCapability = "chat" | "search" | "image";
export type AuthStyle = "bearer" | "x-api-key" | "api-key" | "query" | "none";

/** One provider as the API reports it — never carries the key. */
export interface ProviderInfo {
  id: string;
  label: string;
  vendor: string;
  kind: ProviderKind;
  capability: ProviderCapability;
  base_url: string;
  auth: AuthStyle;
  default_model: string | null;
  docs_url: string | null;
  models: string[];
  models_endpoint: boolean;
  requires_key: boolean;
  openai_shaped: boolean;
  templated: boolean;
  is_builtin: boolean;
  has_key: boolean;
  configured: boolean;
  /** True once the user stored a row for this provider (key, or enabling a local server). */
  user_configured: boolean;
  key_hint: string | null;
}

/** Fields accepted when adding or enabling a provider. */
export interface ProviderInput {
  id?: string;
  label?: string;
  vendor?: string;
  kind?: ProviderKind;
  capability?: ProviderCapability;
  base_url?: string;
  auth_style?: AuthStyle;
  api_key?: string;
  default_model?: string;
  models?: string[];
}

export interface ProviderTestResult {
  ok: boolean;
  latency_ms: number;
  model: string | null;
  error: string | null;
}

export interface ProviderModelsResult {
  models: string[];
  source: "live" | "static";
}

// Electron preload injects the backend port; the web build falls back to env/default.
const bridge =
  typeof window !== "undefined"
    ? (window as { contextgit?: { apiBase?: string; apiToken?: string } }).contextgit
    : undefined;
const envBase =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_CONTEXTGIT_API
    : undefined;
const base = bridge?.apiBase ?? envBase ?? "http://127.0.0.1:8000";
let expectedRepository: string | undefined;

function launchHeaders(): Record<string, string> {
  return bridge?.apiToken ? { Authorization: `Bearer ${bridge.apiToken}` } : {};
}

export type SessionKind = "chat" | "terminal";
export type SessionStatus = "idle" | "running" | "done" | "error";

/** Ask the asset agent for a plan through one of its own providers. */
export interface AssetAgentInput {
  provider_id: string;
  model?: string;
  instruction: string;
  catalog: {
    assets: {
      id: string;
      name: string;
      kind: string;
      folder: string;
      tags: string[];
    }[];
    folders: string[];
  };
}

/** A planned asset-agent action (shape validated on the backend). */
export interface AssetAgentAction {
  type: string;
  [key: string]: unknown;
}

export interface AssetAgentResponse {
  actions: AssetAgentAction[];
}

export interface Session {
  id: string;
  name: string;
  kind: SessionKind;
  branch: string;
  status: SessionStatus;
  agent: string | null;
  auto_commit: boolean;
  worktree_path: string | null;
  git_branch: string | null;
  base_ref: string | null;
  base_commit: string | null;
  /** The project folder this run belongs to (for grouping runs by project). */
  project_path: string | null;
  task: string | null;
  scope: string[];
  /** The role this run plays, and the skills auto-loaded for it. */
  role: string | null;
  skills: string[];
  /** A private local port for this run's dev server. */
  port: number | null;
  /** Set when the run is in Storage (trash); null means live. */
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryConflict {
  topic: string;
  existing: string;
  proposed: string;
  source_session_ids: string[];
}

export interface ProjectMemoryRevision {
  id: string;
  project_path: string;
  revision: number;
  status: "draft" | "approved";
  summary: string;
  architecture: string[];
  workflow: string[];
  conventions: string[];
  decisions: string[];
  rejected: string[];
  skills: string[];
  validation: string[];
  open_questions: string[];
  conflicts: MemoryConflict[];
  source_session_ids: string[];
  source_commit_ids: string[];
  provider: string | null;
  model: string | null;
  created_at: string;
  approved_at: string | null;
}

export interface ProjectMemoryPreview {
  revision: number;
  summary: string;
  text: string;
}

export interface SessionDetail {
  session: Session;
  messages: Message[];
  staged_messages: Message[];
  agent_run: AgentRun | null;
  workspace_status: WorkspaceStatus | null;
  commits: Commit[];
  project_memory_preview: ProjectMemoryPreview | null;
}

/** The Storage view payload: trashed runs/conversations and trashed branches. */
export interface TrashSnapshot {
  sessions: Session[];
  branches: Branch[];
}

/** Code state of one run's worktree (`GET /sessions/{id}/workspace`). */
export interface WorkspaceStatus {
  session_id: string;
  worktree_path: string | null;
  git_branch: string | null;
  base_commit: string | null;
  target: string | null;
  changed_files: string[];
  ahead: number;
  behind: number;
  dirty: boolean;
  clean: boolean;
  conflicts: string[];
}

/** One run in the fleet board (`GET /fleet`). */
export interface FleetEntry {
  session_id: string;
  name: string;
  agent: string | null;
  status: SessionStatus;
  branch: string;
  git_branch: string | null;
  worktree_path: string | null;
  changed_files: string[];
  ahead: number;
  behind: number;
  clean: boolean;
  overlaps: string[];
}

/** Sessions whose claimed scope overlaps a proposed one. */
export interface ClaimCheckResult {
  conflicts: string[];
}

export type MergeStatus = "queued" | "merged" | "blocked" | "failed";

/** The code and context commits created by merging one run. */
export interface PairedMerge {
  source_branch: string;
  git_target: string;
  context_target: string;
  code_commit_id: string;
  context_commit_id: string;
}

/** Semantic conflicts between two runs' context branches. */
export interface CrossRunConflict {
  session_id: string;
  name: string;
  conflicts: {
    id: string;
    category: string;
    topic: string;
    source: string;
    target: string;
  }[];
}

/** A run waiting to merge into a target branch. */
export interface MergeQueueEntry {
  id: number;
  session_id: string;
  target: string;
  position: number;
  status: MergeStatus;
  conflicts: string[];
  commit_id: string | null;
  created_at: string;
  updated_at: string;
}

// ---------- team mode ----------

export type TaskStatus =
  "todo" | "blocked" | "working" | "review" | "done" | "failed";
export type TeamMessageKind =
  | "update"
  | "question"
  | "answer"
  | "handoff"
  | "contract"
  | "review"
  | "gate"
  | "system";

/** One mission: a named set of tasks over a project folder. */
export interface Team {
  id: string;
  name: string;
  project_path: string;
  base_ref: string | null;
  /** The team's default quality gate command (detected or authored). */
  gate_command: string | null;
  created_at: string;
  updated_at: string;
}

/** One unit of team work, owned by one run and bounded by a file scope. */
export interface Task {
  id: string;
  team_id: string;
  title: string;
  brief: string;
  done_criteria: string;
  role: string;
  status: TaskStatus;
  agent: string | null;
  session_id: string | null;
  scope: string[];
  contract: string | null;
  position: number;
  /** Derived: the tasks this one waits on, and the ones still unfinished. */
  depends_on: string[];
  blocked_by: string[];
  /** Quality gate: the project command run in this task's worktree. */
  gate_command: string | null;
  gate_status: "pass" | "fail" | null;
  gate_exit_code: number | null;
  gate_output: string | null;
  gate_ran_at: string | null;
  /** Independent review: a read-only run that inspects the diff. */
  verifier_session_id: string | null;
  review_note: string | null;
  /** Derived: the committed context size of this task's branch. */
  tokens: number;
  created_at: string;
  updated_at: string;
}

/** One line on the team board feed. */
export interface TeamMessage {
  id: number;
  team_id: string;
  task_id: string | null;
  from_task_id: string | null;
  kind: TeamMessageKind;
  body: string;
  created_at: string;
}

/** The board the Team view renders. */
export interface TeamBoard {
  team: Team;
  tasks: Task[];
  messages: TeamMessage[];
  current_branch: string;
}

/** Fields accepted when creating or editing a task. */
export interface TaskInput {
  title: string;
  brief?: string;
  done_criteria?: string;
  role?: string;
  agent?: string | null;
  scope?: string[];
  contract?: string | null;
  depends_on?: string[];
  gate_command?: string | null;
}

function repositoryHeaders(): Record<string, string> {
  const status = typeof window !== "undefined" ? window.contextgit?.getStatus().status : undefined;
  if (status?.state === "ready" && status.repoId) {
    expectedRepository ??= status.repoId;
    if (expectedRepository !== status.repoId) throw new ApiError("Backend repository changed. Reopen this workspace.", 409, "RepositoryMismatch");
  }
  return expectedRepository ? { "X-ContextGit-Repo": expectedRepository } : {};
}

async function request<T>(path: string, init?: RequestOptions): Promise<T> {
  const repoHeaders = repositoryHeaders();
  return apiRequest<T>(`${base}${path}`, {
    timeoutMs: requestTimeout(path, init?.method),
    ...init,
    headers: { "Content-Type": "application/json", ...launchHeaders(), ...repoHeaders, ...init?.headers },
  });
}

/** Real context size of a branch, for the inspector. */
export interface BranchBudget {
  head: string;
  used: number;
  messages: number;
}

// ---------- usage (merged token accounting across every surface) ----------

export type UsageSurface = "chat" | "council" | "research" | "image" | "code";
export type UsageSource = "provider" | "estimate";

export interface UsageTotals {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** How much of `total_tokens` came from estimates rather than real usage. */
  estimated_tokens: number;
  calls: number;
}

export interface UsageRow {
  provider: string | null;
  model: string | null;
  surface: UsageSurface | null;
  source: UsageSource | null;
  totals: UsageTotals;
}

/** One calendar day's usage (UTC), for the trend chart and activity heatmap. */
export interface UsageDay {
  date: string;
  totals: UsageTotals;
}

/** Consecutive-day activity stats, computed over every recorded usage event. */
export interface UsageStreak {
  current: number;
  longest: number;
  active_days: number;
  last_active: string | null;
}

export interface UsageSummary {
  totals: UsageTotals;
  by_provider: UsageRow[];
  by_surface: UsageRow[];
  by_source: UsageRow[];
  /** Daily buckets within the requested window, oldest first. */
  by_day: UsageDay[];
  /** Daily buckets over the last 365 days, for the contribution graph. */
  activity: UsageDay[];
  /** All-time streaks (independent of the requested window). */
  streak: UsageStreak;
}

// ---------- harness limits (each CLI's own account limits) ----------

export interface LimitWindow {
  label: string;
  used: number;
  cap: number;
  reset_at: string | null;
  unit: string;
}

export interface LimitCredits {
  monthly_remaining: number | null;
  purchased_remaining: number | null;
  free_remaining: number | null;
  /** Freebuff keeps a separate wallet pool from its daily allowance. */
  wallet_remaining: number | null;
  total_remaining: number | null;
  total_spent: number | null;
}

export interface LimitTotals {
  total_tokens: number | null;
  total_cost: number | null;
  requests: number | null;
  period: string | null;
}

export interface HarnessLimits {
  state?: "available" | "waiting" | "not_signed_in" | "unsupported" | "error";
  scope?: "account" | "session" | "local_project";
  session_id?: string;
  launch_id?: string;
  launch_started_at?: string;
  account_reading?: HarnessLimits;
  stale?: boolean;
  harness: string;
  label: string;
  /** Whether this app has an adapter for the harness at all. */
  supported: boolean;
  signed_in: boolean;
  source: string | null;
  plan: string | null;
  windows: LimitWindow[];
  credits: LimitCredits | null;
  totals: LimitTotals | null;
  /** Why limits are unavailable (not an error), when they are. */
  message: string | null;
  fetched_at: string;
}

/** Provenance for one context message: the commit that introduced it. */
export interface BlameEntry {
  index: number;
  role: Role;
  content: string;
  commit_id: string;
  kind: CommitKind;
  model: string;
  summary: string | null;
  author: string | null;
  created_at: string;
}

// ---------- HTTP client (the API tab) ----------

export type HttpBodyKind = "none" | "json" | "text" | "form";
export type HttpAuthKind = "none" | "bearer" | "basic" | "api-key" | "cookie";

export interface HttpKeyValue {
  name: string;
  value: string;
  enabled: boolean;
}

export interface HttpRequestSpec {
  method: string;
  url: string;
  params: HttpKeyValue[];
  headers: HttpKeyValue[];
  body_kind: HttpBodyKind;
  body: string;
  auth_kind: HttpAuthKind;
  auth_value: string;
  timeout_s: number;
  verify_tls: boolean;
  follow_redirects: boolean;
}

export interface HttpResponseResult {
  status: number;
  reason: string;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
  elapsed_ms: number;
  size: number;
  url: string;
}

export interface HttpSavedRequest {
  name: string;
  spec: HttpRequestSpec;
}

export interface HttpCollection {
  name: string;
  requests: HttpSavedRequest[];
}

export interface HttpHistoryEntry {
  id: number;
  method: string;
  url: string;
  status: number;
  elapsed_ms: number;
  size: number;
  created_at: string;
}

/** A blank request, so the view always has a complete spec to edit. */
export function emptyHttpRequest(): HttpRequestSpec {
  return {
    method: "GET",
    url: "",
    params: [],
    headers: [],
    body_kind: "none",
    body: "",
    auth_kind: "none",
    auth_value: "",
    timeout_s: 30,
    verify_tls: true,
    follow_redirects: true,
  };
}

// ---------- endpoint graph (the Endpoints tab) ----------

export type EndpointSourceKind =
  "openapi" | "python" | "django" | "javascript" | "go" | "manual";
export type Confidence = "high" | "medium" | "low";
export type FieldLocation = "path" | "query" | "header" | "cookie" | "body";

export interface EndpointSource {
  kind: EndpointSourceKind;
  file: string | null;
  line: number | null;
  confidence: Confidence;
}

export interface EndpointField {
  name: string;
  location: FieldLocation;
  type: string | null;
  required: boolean;
}

/** Where an endpoint came from: the commit, the run, and its conversation. */
export interface EndpointProvenance {
  tracked: boolean;
  code_commit: string | null;
  code_commit_summary: string | null;
  author: string | null;
  committed_at: string | null;
  run_id: string | null;
  run_name: string | null;
  agent: string | null;
  model: string | null;
  context_commit: string | null;
  context_branch: string | null;
  summary: string | null;
  excerpt: string | null;
  decisions: string[];
  dead_ends: string[];
  open_questions: string[];
}

export interface Endpoint {
  id: string;
  method: string;
  path: string;
  operation: string | null;
  tags: string[];
  auth: boolean;
  request_fields: EndpointField[];
  response_status: number | null;
  source: EndpointSource;
  provenance: EndpointProvenance | null;
}

export interface EndpointGraph {
  project_path: string;
  generated_at: string;
  scanned_files: number;
  endpoints: Endpoint[];
}

export type RunCommandSource =
  | "env"
  | "package.json"
  | "make"
  | "django"
  | "uvicorn"
  | "flask"
  | "go"
  | "rust";

export interface RunCommand {
  command: string;
  cwd: string;
  source: RunCommandSource;
  port: number | null;
}

export interface ServerStatus {
  running: boolean;
  healthy: boolean;
  command: string | null;
  cwd: string | null;
  port: number | null;
  url: string | null;
  started_at: string | null;
  exit_code: number | null;
  error: string | null;
  log: string[];
  detected: RunCommand | null;
}

export type TestStatus = "untested" | "pass" | "fail";
/** Whether a generated test still describes the endpoint it was written for. */
export type TestState = "untested" | "fresh" | "stale" | "retired";

export interface EndpointTestFile {
  endpoint_id: string;
  file: string;
  handler: string | null;
  tests: string[];
  status: TestStatus;
  detail: string | null;
  ran_at: string | null;
  verified_at_commit: string | null;
  state: TestState;
  reason: string | null;
}

export interface EndpointTestSuite {
  project_path: string;
  files: EndpointTestFile[];
  passed: number;
  failed: number;
  stale: number;
  retired: number;
  output: string | null;
}

export interface EndpointGenerateResponse {
  file: EndpointTestFile;
  suite: EndpointTestSuite;
  overwrote: boolean;
  failure: string | null;
}

/** One change that shaped a file or line, with the reasoning behind it. */
export interface WhyFinding {
  code_commit: string | null;
  summary: string | null;
  author: string | null;
  committed_at: string | null;
  tracked: boolean;
  run_id: string | null;
  run_name: string | null;
  agent: string | null;
  model: string | null;
  context_branch: string | null;
  excerpt: string | null;
  decisions: string[];
  dead_ends: string[];
  open_questions: string[];
  facts: string[];
}

export interface WhyAnswer {
  path: string;
  line: number | null;
  as_of: string | null;
  reasoned: boolean;
  cached: boolean;
  note: string | null;
  findings: WhyFinding[];
}

/** How one environment variable differs between two runs (hashes, never values). */
export interface EnvDrift {
  key: string;
  change: "added" | "removed" | "changed";
  before: string | null;
  after: string | null;
}

export interface BisectStep {
  commit: string;
  summary: string | null;
  ok: boolean;
}

export interface BisectResult {
  project_path: string;
  command: string;
  good: string;
  bad: string;
  culprit: string | null;
  culprit_summary: string | null;
  steps: BisectStep[];
  probes: number;
  note: string | null;
  log: string | null;
  run_id: string | null;
  run_name: string | null;
  decisions: string[];
  dead_ends: string[];
  env_drift: EnvDrift[];
}

// ---------- database client (the DB tab) ----------

export type DbEngine = "sqlite" | "postgres" | "sqlserver";

export interface DbConnectionSpec {
  name: string;
  engine: DbEngine;
  path: string | null;
  host: string | null;
  port: number | null;
  database: string | null;
  user: string | null;
  ssl: boolean;
  readonly: boolean;
}

export interface DbConnectionInfo {
  id: string;
  name: string;
  engine: DbEngine;
  server_version: string | null;
  database: string | null;
  readonly: boolean;
}

export interface DbColumn {
  name: string;
  type: string | null;
  nullable: boolean;
}

export interface DbTable {
  schema_name: string | null;
  name: string;
  kind: "table" | "view";
  columns: DbColumn[];
}

export interface DbQueryResult {
  columns: string[];
  rows: (string | null)[][];
  row_count: number;
  truncated: boolean;
  elapsed_ms: number;
  statement: string;
}

export const api = {
  snapshot: () => request<RepoSnapshot>("/api/v1/repo"),
  branchBudget: (name: string) =>
    request<BranchBudget>(
      `/api/v1/branches/${encodeURIComponent(name)}/budget`,
    ),
  usage: (days?: number) =>
    request<UsageSummary>(`/api/v1/usage${days ? `?days=${days}` : ""}`),
  limits: (refresh = false, harness?: string) =>
    request<HarnessLimits[]>(`/api/v1/limits?refresh=${refresh}${harness ? `&harness=${encodeURIComponent(harness)}` : ""}`),
  integrationSettings: (project: string) => request<IntegrationSettings>(`/api/v1/integration/settings?project=${encodeURIComponent(project)}`),
  configureIntegration: (settings: IntegrationSettings) => request<IntegrationSettings>("/api/v1/integration/settings", { method: "PUT", body: JSON.stringify(settings) }),
  integrationJobs: (project?: string) => request<IntegrationJob[]>(`/api/v1/integration/jobs${project ? `?project=${encodeURIComponent(project)}` : ""}`),
  readyForIntegration: (session: string) => request<IntegrationJob>(`/api/v1/integration/ready/${encodeURIComponent(session)}`, { method: "POST" }),
  integrationAction: (id: string, action: "cancel" | "retry") => request<IntegrationJob>(`/api/v1/integration/jobs/${encodeURIComponent(id)}/${action}`, { method: "POST" }),
  documents: () => request<DocumentInfo[]>("/api/v1/documents"),
  branchBlame: (name: string) =>
    request<BlameEntry[]>(`/api/v1/branches/${encodeURIComponent(name)}/blame`),
  commits: (branch: string) =>
    request<CommitResponse[]>(
      `/api/v1/commits?branch=${encodeURIComponent(branch)}`,
    ),
  context: (commitId: string) =>
    request<Message[]>(
      `/api/v1/context?commit_id=${encodeURIComponent(commitId)}`,
    ),
  branchContext: (name: string) =>
    request<Message[]>(`/api/v1/context?branch=${encodeURIComponent(name)}`),
  commitConversation: (commitId: string) =>
    request<Message[]>(`/api/v1/commits/${encodeURIComponent(commitId)}/conversation`),
  conversationPage: (commitId: string, cursor = 0, signal?: AbortSignal) =>
    request<{ messages: Message[]; next_cursor: number | null }>(
      `/api/v1/commits/${encodeURIComponent(commitId)}/conversation/page?cursor=${cursor}`, { signal },
    ),
  diff: (a: string, b: string) =>
    request<Diff>(
      `/api/v1/diff?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`,
    ),
  createBranch: (name: string, fromCommit: string) =>
    request<Branch>("/api/v1/branches", {
      method: "POST",
      body: JSON.stringify({ name, from_commit: fromCommit }),
    }),
  deleteBranch: (name: string, permanent = false) =>
    request<void>(
      `/api/v1/branches?name=${encodeURIComponent(name)}${permanent ? "&permanent=true" : ""}`,
      { method: "DELETE" },
    ),
  restoreBranch: (name: string) =>
    request<Branch>(
      `/api/v1/branches/restore?name=${encodeURIComponent(name)}`,
      {
        method: "POST",
      },
    ),
  checkout: (ref: string) =>
    request<{ ref: string; current_branch: string }>("/api/v1/checkout", {
      method: "POST",
      body: JSON.stringify({ ref }),
    }),
  mergePreview: (source: string, into: string) =>
    request<MergePreview>("/api/v1/merge/preview", {
      method: "POST",
      body: JSON.stringify({ source, into }),
    }),
  mergeApply: (
    preview: MergePreview,
    resolutions: Record<string, string>,
    summary: string,
  ) =>
    request<CommitResponse>("/api/v1/merge/apply", {
      method: "POST",
      body: JSON.stringify({ preview, resolutions, summary }),
    }),
  compare: (prompt: string, branchA: string, branchB: string, model: string) =>
    request<CompareResult>("/api/v1/compare", {
      method: "POST",
      body: JSON.stringify({
        prompt,
        branch_a: branchA,
        branch_b: branchB,
        model,
      }),
    }),
  commit: (input: {
    messages: Message[];
    model?: string;
    summary?: string;
    branch?: string;
  }) =>
    request<CommitResponse>("/api/v1/commits", {
      method: "POST",
      body: JSON.stringify({
        messages: input.messages,
        model: input.model ?? "none",
        summary: input.summary,
        branch: input.branch,
      }),
    }),
  // ---------- providers (the add-a-provider flow) ----------
  providers: () => request<ProviderInfo[]>("/api/v1/providers"),
  addProvider: (input: ProviderInput) =>
    request<ProviderInfo>("/api/v1/providers", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteProvider: (id: string) =>
    request<void>(`/api/v1/providers/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  testProvider: (id: string) =>
    request<ProviderTestResult>(
      `/api/v1/providers/${encodeURIComponent(id)}/test`,
      {
        method: "POST",
      },
    ),
  fetchProviderModels: (id: string) =>
    request<ProviderModelsResult>(
      `/api/v1/providers/${encodeURIComponent(id)}/models`,
      {
        method: "POST",
      },
    ),
  // ---------- asset agent (its own isolated provider store) ----------
  agentProviders: () => request<ProviderInfo[]>("/api/v1/agent-providers"),
  addAgentProvider: (input: ProviderInput) =>
    request<ProviderInfo>("/api/v1/agent-providers", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteAgentProvider: (id: string) =>
    request<void>(`/api/v1/agent-providers/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  testAgentProvider: (id: string) =>
    request<ProviderTestResult>(
      `/api/v1/agent-providers/${encodeURIComponent(id)}/test`,
      {
        method: "POST",
      },
    ),
  fetchAgentProviderModels: (id: string) =>
    request<ProviderModelsResult>(
      `/api/v1/agent-providers/${encodeURIComponent(id)}/models`,
      {
        method: "POST",
      },
    ),
  assetAgent: (input: AssetAgentInput) =>
    request<AssetAgentResponse>("/api/v1/assets/agent", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  // ---------- HTTP client (the API tab) ----------
  httpRequest: (spec: HttpRequestSpec) =>
    request<HttpResponseResult>("/api/v1/http/request", {
      method: "POST",
      body: JSON.stringify(spec),
    }),
  httpCollections: () => request<string[]>("/api/v1/http/collections"),
  httpCollection: (name: string) =>
    request<HttpCollection>(
      `/api/v1/http/collections/${encodeURIComponent(name)}`,
    ),
  saveHttpCollection: (name: string, collection: HttpCollection) =>
    request<HttpCollection>(
      `/api/v1/http/collections/${encodeURIComponent(name)}`,
      {
        method: "PUT",
        body: JSON.stringify(collection),
      },
    ),
  deleteHttpCollection: (name: string) =>
    request<void>(`/api/v1/http/collections/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),
  httpHistory: (limit = 50) =>
    request<HttpHistoryEntry[]>(`/api/v1/http/history?limit=${limit}`),
  // ---------- endpoint graph (the Endpoints tab) ----------
  endpoints: (projectPath?: string) =>
    request<EndpointGraph>(
      `/api/v1/endpoints${projectPath ? `?project_path=${encodeURIComponent(projectPath)}` : ""}`,
    ),
  refreshEndpoints: (projectPath?: string) =>
    request<EndpointGraph>(
      `/api/v1/endpoints/refresh${
        projectPath ? `?project_path=${encodeURIComponent(projectPath)}` : ""
      }`,
      { method: "POST" },
    ),
  // ---------- the project's server + its generated tests ----------
  serveStatus: (projectPath?: string) =>
    request<ServerStatus>(
      `/api/v1/endpoints/serve${
        projectPath ? `?project_path=${encodeURIComponent(projectPath)}` : ""
      }`,
    ),
  startServer: (projectPath: string, command?: string) =>
    request<ServerStatus>("/api/v1/endpoints/serve", {
      method: "POST",
      body: JSON.stringify({ project_path: projectPath, command }),
    }),
  stopServer: () => request<ServerStatus>("/api/v1/endpoints/serve", { method: "DELETE" }),
  endpointTests: (projectPath: string) =>
    request<EndpointTestSuite>(
      `/api/v1/endpoints/tests?project_path=${encodeURIComponent(projectPath)}`,
    ),
  generateEndpointTests: (
    projectPath: string,
    endpointId: string,
    providerId: string,
    model?: string,
  ) =>
    request<EndpointGenerateResponse>("/api/v1/endpoints/tests/generate", {
      method: "POST",
      body: JSON.stringify({
        project_path: projectPath,
        endpoint_id: endpointId,
        provider_id: providerId,
        model: model ?? null,
      }),
    }),
  runEndpointTests: (projectPath: string, baseUrl?: string) =>
    request<EndpointTestSuite>("/api/v1/endpoints/tests/run", {
      method: "POST",
      body: JSON.stringify({ project_path: projectPath, base_url: baseUrl ?? null }),
    }),
  reconcileEndpointTests: (projectPath: string) =>
    request<EndpointTestSuite>("/api/v1/endpoints/tests/reconcile", {
      method: "POST",
      body: JSON.stringify({ project_path: projectPath }),
    }),
  bisectEndpointTests: (params: {
    projectPath: string;
    endpointId?: string;
    good?: string | null;
    bad?: string | null;
    command?: string;
    providerId?: string;
  }) =>
    request<BisectResult>("/api/v1/endpoints/tests/bisect", {
      method: "POST",
      body: JSON.stringify({
        project_path: params.projectPath,
        endpoint_id: params.endpointId ?? null,
        good: params.good ?? null,
        bad: params.bad ?? null,
        command: params.command ?? null,
        provider_id: params.providerId ?? null,
      }),
    }),
  // ---------- database client (the DB tab) ----------
  dbDrivers: () => request<Record<string, boolean>>("/api/v1/db/drivers"),
  dbConnections: () => request<string[]>("/api/v1/db/connections"),
  dbConnection: (name: string) =>
    request<DbConnectionSpec>(`/api/v1/db/connections/${encodeURIComponent(name)}`),
  saveDbConnection: (name: string, spec: DbConnectionSpec) =>
    request<DbConnectionSpec>(`/api/v1/db/connections/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify(spec),
    }),
  deleteDbConnection: (name: string) =>
    request<void>(`/api/v1/db/connections/${encodeURIComponent(name)}`, { method: "DELETE" }),
  openDb: (spec: DbConnectionSpec, password?: string) =>
    request<DbConnectionInfo>("/api/v1/db/open", {
      method: "POST",
      body: JSON.stringify({ spec, password: password ?? null }),
    }),
  closeDb: (connectionId: string) =>
    request<boolean>(`/api/v1/db/open/${encodeURIComponent(connectionId)}`, { method: "DELETE" }),
  dbSchema: (connectionId: string) =>
    request<DbTable[]>(`/api/v1/db/schema?connection_id=${encodeURIComponent(connectionId)}`),
  dbQuery: (connectionId: string, sql: string, limit?: number) =>
    request<DbQueryResult>("/api/v1/db/query", {
      method: "POST",
      body: JSON.stringify({ connection_id: connectionId, sql, limit: limit ?? null }),
    }),
  // ---------- rationale blame (the Why lens) ----------
  why: (params: {
    projectPath: string;
    path: string;
    line?: number | null;
    asOf?: string | null;
    providerId?: string;
  }) => {
    const query = new URLSearchParams({
      project_path: params.projectPath,
      path: params.path,
    });
    if (params.line) query.set("line", String(params.line));
    if (params.asOf) query.set("as_of", params.asOf);
    if (params.providerId) query.set("provider_id", params.providerId);
    return request<WhyAnswer>(`/api/v1/why?${query.toString()}`);
  },
  whyHistory: (projectPath: string, path: string) =>
    request<WhyFinding[]>(
      `/api/v1/why/history?project_path=${encodeURIComponent(
        projectPath,
      )}&path=${encodeURIComponent(path)}`,
    ),
  // ---------- sessions (parallel AI runs) ----------
  sessions: () => request<Session[]>("/api/v1/sessions"),
  agentRuns: () => request<AgentRun[]>("/api/v1/agent/runs"),
  agentRun: (id: string) => request<AgentRun>(`/api/v1/agent/runs/${id}`),
  createAgentRun: (task: string, provider?: string, model?: string) => request<AgentRun>("/api/v1/agent/runs", { method: "POST", body: JSON.stringify({ task, provider, model }) }),
  approveAgentRun: (id: string, decision: "approved" | "rejected") => request<AgentRun>(`/api/v1/agent/runs/${id}/approval`, { method: "POST", body: JSON.stringify({ decision }) }),
  cancelAgentRun: (id: string) => request<AgentRun>(`/api/v1/agent/runs/${id}/cancel`, { method: "POST" }),
  commitAgentRun: (id: string, message?: string) => request<AgentRun>(`/api/v1/agent/runs/${id}/commit`, { method: "POST", body: JSON.stringify({ message }) }),
  createAgentIssue: (id: string, title: string, body: string) => request<LocalIssue>(`/api/v1/agent/runs/${id}/issue`, { method: "POST", body: JSON.stringify({ title, body }) }),
  session: (id: string) => request<Session>(`/api/v1/sessions/${id}`),
  sessionDetail: (id: string) => request<SessionDetail>(`/api/v1/sessions/${id}/detail`),
  workspace: (id: string) =>
    request<WorkspaceStatus>(`/api/v1/sessions/${id}/workspace`),
  fleet: () => request<FleetEntry[]>("/api/v1/fleet"),
  preflight: (id: string, target?: string) =>
    request<WorkspaceStatus>(`/api/v1/sessions/${id}/preflight`, {
      method: "POST",
      body: JSON.stringify({ target }),
    }),
  checkClaims: (scope: string[], sessionId?: string) =>
    request<ClaimCheckResult>("/api/v1/fleet/claims/check", {
      method: "POST",
      body: JSON.stringify({ scope, session_id: sessionId }),
    }),
  mergeQueue: () => request<MergeQueueEntry[]>("/api/v1/merge-queue"),
  enqueueMerge: (sessionId: string, target?: string) =>
    request<MergeQueueEntry>("/api/v1/merge-queue", {
      method: "POST",
      body: JSON.stringify({ session_id: sessionId, target }),
    }),
  dequeueMerge: (id: number) =>
    request<void>(`/api/v1/merge-queue/${id}`, { method: "DELETE" }),
  runMergeQueue: (target?: string) =>
    request<MergeQueueEntry[]>("/api/v1/merge-queue/run", {
      method: "POST",
      body: JSON.stringify({ target }),
    }),
  integrateRun: (id: string, target?: string, gitTarget?: string) =>
    request<PairedMerge>(`/api/v1/sessions/${id}/integrate`, {
      method: "POST",
      body: JSON.stringify({ target, git_target: gitTarget }),
    }),
  sessionContext: (id: string) =>
    request<{ text: string }>(`/api/v1/sessions/${id}/context`),
  crossRunConflicts: (id: string) =>
    request<CrossRunConflict[]>(`/api/v1/sessions/${id}/cross-conflicts`, {
      method: "POST",
    }),
  createSession: (input: {
    name: string;
    kind?: SessionKind;
    branch?: string;
    agent?: string;
    autoCommit?: boolean;
    fromCommit?: string;
    projectPath?: string;
    worktree?: boolean;
    baseRef?: string;
    task?: string;
    scope?: string[];
    role?: string;
    skills?: string[];
  }) =>
    request<Session>("/api/v1/sessions", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        kind: input.kind ?? "chat",
        branch: input.branch,
        agent: input.agent,
        auto_commit: input.autoCommit ?? false,
        from_commit: input.fromCommit,
        project_path: input.projectPath,
        worktree: input.worktree ?? false,
        base_ref: input.baseRef,
        task: input.task,
        scope: input.scope ?? [],
        role: input.role,
        skills: input.skills ?? [],
      }),
    }),
  updateSession: (
    id: string,
    patch: { name?: string; status?: SessionStatus; auto_commit?: boolean },
  ) =>
    request<Session>(`/api/v1/sessions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  trash: () => request<TrashSnapshot>("/api/v1/trash"),
  deleteSession: (id: string, permanent = false) =>
    request<void>(
      `/api/v1/sessions/${id}${permanent ? "?permanent=true" : ""}`,
      {
        method: "DELETE",
      },
    ),
  restoreSession: (id: string) =>
    request<Session>(`/api/v1/sessions/${id}/restore`, { method: "POST" }),
  projectMemory: (projectPath: string) =>
    request<{ project_path: string; current: ProjectMemoryRevision | null; text: string }>(
      `/api/v1/project-memory?project_path=${encodeURIComponent(projectPath)}`,
    ),
  synthesizeProjectMemory: (input: {
    projectPath: string;
    sessionIds?: string[];
    provider?: string;
    model?: string;
  }) =>
    request<ProjectMemoryRevision>("/api/v1/project-memory/synthesize", {
      method: "POST",
      body: JSON.stringify({
        project_path: input.projectPath,
        session_ids: input.sessionIds,
        provider: input.provider,
        model: input.model,
      }),
    }),
  approveProjectMemory: (revisionId: string, memory: ProjectMemoryRevision) =>
    request<ProjectMemoryRevision>(`/api/v1/project-memory/${encodeURIComponent(revisionId)}/approve`, {
      method: "POST",
      body: JSON.stringify({ memory }),
    }),
  captureState: (id: string) => request<CaptureState>(`/api/v1/sessions/${id}/capture`),
  bindConversation: (id: string, nativeId: string) => request<CaptureState>(`/api/v1/sessions/${id}/capture`, {
    method: "PUT", body: JSON.stringify({ native_id: nativeId }),
  }),
  captureConversation: (id: string) => request<CaptureState>(`/api/v1/sessions/${id}/capture`, { method: "POST" }),
  staging: (id: string) => request<Message[]>(`/api/v1/sessions/${id}/staging`),
  stage: (id: string, messages: Message[]) =>
    request<Message[]>(`/api/v1/sessions/${id}/staging`, {
      method: "POST",
      body: JSON.stringify({ messages }),
    }),
  unstage: (id: string, lastOnly = false) =>
    request<Message[]>(
      `/api/v1/sessions/${id}/staging${lastOnly ? "?last=true" : ""}`,
      { method: "DELETE" },
    ),
  commitStaged: (id: string, summary?: string, model?: string) =>
    request<CommitResponse>(`/api/v1/sessions/${id}/commit`, {
      method: "POST",
      body: JSON.stringify({ summary, model }),
    }),
  // ---------- repository issues ----------
  issueConfig: () => request<IssueConfig>("/api/v1/issues/config"),
  updateIssueConfig: (input: Partial<IssueConfig>) => request<IssueConfig>("/api/v1/issues/config", {
    method: "PUT", body: JSON.stringify(input),
  }),
  issueScans: () => request<IssueScanRun[]>("/api/v1/issues/scans"),
  issueFindings: () => request<IssueFinding[]>("/api/v1/issues/findings"),
  runIssueScan: () => request<IssueScanRun>("/api/v1/issues/scan", { method: "POST" }),
  installOsvScanner: () => request<{ installed: boolean; detail: string }>("/api/v1/issues/dependencies/install", { method: "POST" }),
  pauseIssueSchedule: () => request<IssueConfig>("/api/v1/issues/schedule/pause", { method: "POST" }),
  resumeIssueSchedule: () => request<IssueConfig>("/api/v1/issues/schedule/resume", { method: "POST" }),
  testGithubIssues: () => request<{ configured: boolean; repository: string | null }>("/api/v1/issues/github/test", { method: "POST" }),
  installIssuesWorkflow: () => request<{ path: string; installed: boolean }>("/api/v1/issues/github/install-workflow", { method: "POST" }),
  // ---------- team mode (a task graph over parallel runs) ----------
  team: () => request<TeamBoard | null>("/api/v1/team"),
  createTeam: (input: {
    name: string;
    projectPath: string;
    baseRef?: string;
  }) =>
    request<TeamBoard>("/api/v1/team", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        project_path: input.projectPath,
        base_ref: input.baseRef,
      }),
    }),
  createTask: (input: TaskInput) =>
    request<Task>("/api/v1/team/tasks", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateTask: (
    id: string,
    patch: Partial<TaskInput> & { status?: TaskStatus },
  ) =>
    request<Task>(`/api/v1/team/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteTask: (id: string) =>
    request<void>(`/api/v1/team/tasks/${id}`, { method: "DELETE" }),
  launchTeam: () => request<Task[]>("/api/v1/team/launch", { method: "POST" }),
  startTask: (id: string) =>
    request<Task>(`/api/v1/team/tasks/${id}/start`, { method: "POST" }),
  completeTask: (id: string) =>
    request<Task>(`/api/v1/team/tasks/${id}/complete`, { method: "POST" }),
  teamMessages: (limit = 50) =>
    request<TeamMessage[]>(`/api/v1/team/messages?limit=${limit}`),
  postTeamMessage: (input: {
    body: string;
    kind?: TeamMessageKind;
    taskId?: string;
  }) =>
    request<TeamMessage>("/api/v1/team/messages", {
      method: "POST",
      body: JSON.stringify({
        body: input.body,
        kind: input.kind ?? "update",
        task_id: input.taskId,
      }),
    }),
  mergeTeam: () =>
    request<MergeQueueEntry[]>("/api/v1/team/merge", { method: "POST" }),
  setTeamGate: (gateCommand: string | null) =>
    request<Team>("/api/v1/team", {
      method: "PATCH",
      body: JSON.stringify({ gate_command: gateCommand }),
    }),
  runTaskGate: (id: string) =>
    request<Task>(`/api/v1/team/tasks/${id}/gate`, { method: "POST" }),
  approveTask: (id: string) =>
    request<Task>(`/api/v1/team/tasks/${id}/approve`, { method: "POST" }),
  rejectTask: (id: string, note: string) =>
    request<Task>(`/api/v1/team/tasks/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),
  verifyTask: (id: string, agent?: string) =>
    request<Task>(`/api/v1/team/tasks/${id}/verify`, {
      method: "POST",
      body: JSON.stringify({ agent }),
    }),
};

/** One parsed server-sent event from a streaming route. */
export interface SseMessage {
  event: string;
  data: unknown;
}

/**
 * POST a JSON body and dispatch every SSE event it returns. Shared by the chat,
 * council, image and research streams so the framing lives in one place.
 */
export async function readSse(
  path: string,
  body: unknown,
  onMessage: (message: SseMessage) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...launchHeaders(),
      ...repositoryHeaders(),
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body)
    throw new Error(`Request failed (${response.status})`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;
  while (!done) {
    const chunk = await reader.read();
    done = chunk.done;
    buffer += decoder.decode(chunk.value, { stream: !done });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const eventName =
        block
          .split("\n")
          .find((line) => line.startsWith("event: "))
          ?.slice(7) ?? "message";
      const dataLine = block
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6);
      if (dataLine === undefined) continue;
      onMessage({ event: eventName, data: JSON.parse(dataLine) as unknown });
    }
  }
}

export async function streamChat(
  input: {
    prompt: string;
    branch: string;
    commitId: string | null;
    model: string;
    provider?: string;
    /** When set with autoCommit false, the turn is staged, not committed. */
    sessionId?: string | null;
    autoCommit?: boolean;
  },
  onToken: (text: string) => void,
  signal?: AbortSignal,
): Promise<{
  answer: string;
  commitId: string | null;
  staged: boolean;
  stagedCount: number;
}> {
  let answer = "";
  let commitId: string | null = null;
  let staged = false;
  let stagedCount = 0;
  let sawDone = false;
  await readSse(
    "/api/v1/chat/stream",
    {
      prompt: input.prompt,
      branch: input.branch,
      commit_id: input.commitId,
      model: input.model,
      provider: input.provider,
      session_id: input.sessionId ?? undefined,
      auto_commit: input.autoCommit,
    },
    (message) => {
      const data = message.data as {
        text?: string;
        error?: string;
        commit_id?: string | null;
        staged?: boolean;
        staged_count?: number;
      };
      if (message.event === "token" && data.text) {
        answer += data.text;
        onToken(data.text);
      } else if (message.event === "done") {
        sawDone = true;
        commitId = data.commit_id ?? null;
        staged = data.staged ?? false;
        stagedCount = data.staged_count ?? 0;
      } else if (message.event === "error") {
        throw new Error(data.error ?? "Chat stream failed");
      }
    },
    signal,
  );
  if (!sawDone) throw new Error("Chat ended without a done event");
  return { answer, commitId, staged, stagedCount };
}

/** One member of a council run: a provider id plus the model to ask. */
export interface CouncilMember {
  provider: string;
  model?: string;
}

export type CouncilEvent =
  | {
      type: "member";
      index: number;
      provider: string;
      model: string;
      label: string;
    }
  | { type: "token"; index: number; text: string }
  | { type: "member_done"; index: number; answer: string }
  | { type: "error"; index?: number; error: string }
  | { type: "done"; commit_id: string | null; branch: string };

/** Ask several providers the same prompt, in parallel. */
export async function streamCouncil(
  input: {
    prompt: string;
    members: CouncilMember[];
    branch: string;
    commitId: string | null;
  },
  onEvent: (event: CouncilEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let sawDone = false;
  await readSse(
    "/api/v1/council/stream",
    {
      prompt: input.prompt,
      members: input.members,
      branch: input.branch,
      commit_id: input.commitId,
    },
    (message) => {
      if (message.event === "done") sawDone = true;
      onEvent({
        type: message.event,
        ...(message.data as object),
      } as CouncilEvent);
    },
    signal,
  );
  if (!sawDone) throw new Error("Council ended without a done event");
}

/** One image returned by an image provider. */
export interface RenderedImage {
  index: number;
  url: string | null;
  data_url: string | null;
  seed: number | null;
  model: string;
  revised_prompt: string | null;
}

export type ImageEvent =
  | { type: "step"; label: string; detail: string }
  | ({ type: "image" } & RenderedImage)
  | {
      type: "done";
      commit_id: string | null;
      branch: string;
      tiles: number;
      staged: boolean;
    }
  | { type: "error"; error: string };

export interface ResearchSourceInfo {
  id: number;
  title: string;
  url: string;
  host: string;
  fetched_at: string;
}

export interface ResearchStepPayload {
  id: string;
  label: string;
  detail: string;
  status: "pending" | "active" | "done";
}

export type ResearchEvent =
  | ({ type: "step" } & ResearchStepPayload)
  | ({ type: "source" } & ResearchSourceInfo)
  | { type: "report"; text: string }
  | ({ type: "result"; mode: string } & Record<string, unknown>)
  | {
      type: "done";
      commit_id: string | null;
      branch: string;
      run_id: string;
      staged: boolean;
    }
  | { type: "error"; error: string };

/** Run a research pass; steps, sources and the report stream as they happen. */
export async function streamResearch(
  input: {
    mode: "deep" | "competitive" | "lead" | "verify";
    prompt: string;
    provider?: string;
    model?: string;
    searchProvider?: string;
    branch: string;
    commitId: string | null;
    breadth: number;
    depth: number;
    maxPages: number;
    sessionId?: string | null;
    autoCommit?: boolean;
  },
  onEvent: (event: ResearchEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let sawDone = false;
  await readSse(
    "/api/v1/research/stream",
    {
      mode: input.mode,
      prompt: input.prompt,
      provider: input.provider,
      model: input.model,
      search_provider: input.searchProvider,
      branch: input.branch,
      commit_id: input.commitId,
      breadth: input.breadth,
      depth: input.depth,
      max_pages: input.maxPages,
      session_id: input.sessionId ?? undefined,
      auto_commit: input.autoCommit,
    },
    (message) => {
      if (message.event === "done") sawDone = true;
      onEvent({
        type: message.event,
        ...(message.data as object),
      } as ResearchEvent);
    },
    signal,
  );
  if (!sawDone) throw new Error("Research ended without a done event");
}

/** Render a prompt with an image provider; each tile arrives as it is ready. */
export async function streamImages(
  input: {
    prompt: string;
    provider: string;
    model: string;
    aspect: string;
    count: number;
    branch: string;
    commitId: string | null;
    sessionId?: string | null;
    autoCommit?: boolean;
  },
  onEvent: (event: ImageEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let sawDone = false;
  await readSse(
    "/api/v1/images/stream",
    {
      prompt: input.prompt,
      provider: input.provider,
      model: input.model,
      aspect: input.aspect,
      count: input.count,
      branch: input.branch,
      commit_id: input.commitId,
      session_id: input.sessionId ?? undefined,
      auto_commit: input.autoCommit,
    },
    (message) => {
      if (message.event === "done") sawDone = true;
      onEvent({
        type: message.event,
        ...(message.data as object),
      } as ImageEvent);
    },
    signal,
  );
  if (!sawDone) throw new Error("Image run ended without a done event");
}

// ---------- documents (Chat "Document" mode: generate a file) ----------

export type DocumentFormat = "md" | "pdf" | "docx" | "pptx";
export type DocumentTemplate = "report" | "brief" | "proposal";

export interface RenderedDocument {
  id: string;
  filename: string;
  format: DocumentFormat;
  size: number;
  title: string;
  markdown: string;
}

/** A previously generated document, for the Docs library list. */
export interface DocumentInfo {
  id: string;
  filename: string;
  format: DocumentFormat;
  size: number;
  title: string;
  created_at: string;
}

export type DocumentEvent =
  | { type: "step"; label: string; detail: string }
  | { type: "token"; text: string }
  | ({ type: "document" } & RenderedDocument)
  | { type: "done"; commit_id: string | null; branch: string; staged: boolean }
  | { type: "error"; error: string };

/** Ask the assistant to write a document on a topic; tokens + progress stream. */
export async function streamDocument(
  input: {
    prompt: string;
    format: DocumentFormat;
    template?: DocumentTemplate;
    provider?: string;
    model?: string;
    branch: string;
    commitId: string | null;
    sessionId?: string | null;
    autoCommit?: boolean;
  },
  onEvent: (event: DocumentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let sawDone = false;
  await readSse(
    "/api/v1/documents/stream",
    {
      prompt: input.prompt,
      format: input.format,
      template: input.template,
      provider: input.provider,
      model: input.model,
      branch: input.branch,
      commit_id: input.commitId,
      session_id: input.sessionId ?? undefined,
      auto_commit: input.autoCommit,
    },
    (message) => {
      if (message.event === "done") sawDone = true;
      onEvent({
        type: message.event,
        ...(message.data as object),
      } as DocumentEvent);
    },
    signal,
  );
  if (!sawDone)
    throw new Error("Document generation ended without a done event");
}

/** Download URL for a rendered document. */
export function documentUrl(id: string, format: DocumentFormat): string {
  return `${base}/api/v1/documents/${encodeURIComponent(id)}?format=${format}`;
}

export interface IntegrationSettings {
  project: string; harness: "codex" | "claude"; target: string; checks: string;
  authority: "enabled" | "paused" | "disabled"; generation: number; branches: string[];
}
export interface IntegrationJob {
  id: string; session_id: string; source_sha: string; target_sha: string | null;
  state: string; attempts: number; candidate_commit: string | null; conflicts: string[];
  feedback: string; resolution_diff: string; check_output: string; verdict: string | null;
  conversation_branch: string; usage: (HarnessLimits & { reading: unknown }) | null;
}
