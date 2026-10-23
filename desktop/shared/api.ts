import { apiRequest, ApiError, requestTimeout, type RequestOptions } from "./apiRequest";
import { prepareProject, projectRuntime } from "./projectRuntime";
import type { Checkpoint, Feedback, Knowledge, Lesson, Preflight, LearningConnectionInput, LearningProvider, LearningSettings } from "./knowledge";
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

// The Tauri runtime installs its bridge during
// application startup, after this module has been evaluated. Resolve it per
// request so Tauri does not get stuck on the browser fallback port.
type ApiBridge = { apiBase?: string; apiToken?: string; getStatus?: () => { apiBase?: string } };
function getBridge(): ApiBridge | undefined {
  return typeof window !== "undefined"
    ? (window as { contextgit?: ApiBridge }).contextgit
    : undefined;
}
const envBase =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_CONTEXTGIT_API
    : undefined;
function backendBase(): string {
  const bridge = getBridge();
  return bridge?.getStatus?.().apiBase ?? bridge?.apiBase ?? envBase ?? "http://127.0.0.1:8000";
}
let expectedRepository: string | undefined;

function launchHeaders(): Record<string, string> {
  const bridge = getBridge();
  return bridge?.apiToken ? { Authorization: `Bearer ${bridge.apiToken}` } : {};
}

export type SessionKind = "chat" | "terminal";
export type SessionStatus = "idle" | "running" | "done" | "error";

export interface Session {
  id: string;
  name: string;
  kind: SessionKind;
  branch: string;
  status: SessionStatus;
  agent: string | null;
  model: string | null;
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
  category?: string;
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
  conversation_status?: string;
  conversation_error?: string | null;
  session: Session;
  messages: Message[];
  staged_messages: Message[];
  terminal_transcript: string;
  agent_run: AgentRun | null;
  workspace_status: WorkspaceStatus | null;
  commits: Commit[];
  project_memory_preview: ProjectMemoryPreview | null;
}

export interface ContextWindowReading {
  session_id: string;
  agent: string | null;
  model: string | null;
  used_tokens: number;
  limit_tokens: number | null;
  percentage: number | null;
  remaining_tokens: number | null;
  source: string;
  estimated: boolean;
  draft_tokens: number;
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
  goal: string;
  state: "draft" | "planning" | "ready" | "running" | "paused" | "review" | "merge_ready" | "completed" | "failed";
  orchestrator_agent: string | null;
  orchestrator_session_id: string | null;
  archived_at: string | null;
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

export interface TeamPlanRevision {
  id: string;
  team_id: string;
  revision: number;
  status: "draft" | "approved" | "superseded";
  plan: { goal?: string; tasks?: TeamPlanTask[] };
  created_at: string;
  updated_at: string;
}

export interface TeamPlanTask {
  id?: string;
  title: string;
  brief?: string;
  done_criteria?: string;
  role?: string;
  agent?: string | null;
  scope?: string[];
  depends_on?: string[];
  gate_command?: string | null;
  skills?: string[];
}

export interface CanvasViewport {
  project_path: string;
  x: number;
  y: number;
  zoom: number;
  updated_at: string;
}

export interface CanvasLayout {
  team_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  collapsed: boolean;
  z_index: number;
  updated_at: string;
}

export interface SpatialTeam extends TeamBoard {
  layout: CanvasLayout;
  plan: TeamPlanRevision | null;
  skills: SkillLink[];
  execution?: { max_active: number; allowed_agents: string[]; integration_branch: string; orchestrator_model?: string | null; worker_models?: Record<string, string> } | null;
  integrations?: Array<{ task_id: string; status: string; error?: string; integration_head?: string }>;
}

export interface SkillLink {
  id: string;
  team_id: string;
  task_id: string | null;
  agent: string | null;
  skill_id: string;
  origin: "built-in" | "project" | "global";
  title: string;
  instruction: string;
  created_at: string;
}

export interface LibrarySkill {
  id: string; origin: 'project' | 'global'; status: 'draft' | 'approved' | 'rejected' | 'removed';
  title: string; instruction: string; evidence: string; scope: string[];
  source_team: string | null; source_session: string | null; revision: number; updated_at: string;
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
  if (status?.state !== "ready") {
    expectedRepository = undefined;
    return {};
  }
  if (status?.state === "ready" && status.repoId) {
    // The Tauri runtime rebinds the local backend when the active
    // project changes. Adopt the new identity in the existing renderer
    // instead of treating a normal project switch as a stale workspace.
    if (expectedRepository !== status.repoId) expectedRepository = status.repoId;
  }
  return expectedRepository ? { "X-ContextGit-Repo": expectedRepository } : {};
}

const sessionProjects = new Map<string, string>();
async function sendRequest<T>(path: string, init?: RequestOptions, owner?: string): Promise<T> {
  const sessionId = /^\/api\/v1\/sessions\/([^/?]+)/.exec(path)?.[1];
  const projectPath = owner ?? (sessionId ? sessionProjects.get(sessionId) : undefined) ?? projectRuntime.read().path;
  const project = projectPath ? await prepareProject(projectPath) : null;
  const repoHeaders = project ? { "X-ContextGit-Repo": project.repoId, "X-ContextGit-Project": project.projectId } : repositoryHeaders();
  const result = await apiRequest<T>(`${backendBase()}${path}`, {
    timeoutMs: requestTimeout(path, init?.method),
    ...init,
    headers: { "Content-Type": "application/json", ...launchHeaders(), ...repoHeaders, ...init?.headers },
  });
  if (projectPath && path === "/api/v1/sessions") {
    for (const session of Array.isArray(result) ? result : [result]) {
      if (session && typeof session === "object" && "id" in session && typeof session.id === "string") sessionProjects.set(session.id, projectPath);
    }
  }
  return result;
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

export function projectApi(owner?: string) {
  const request = <T>(path: string, init?: RequestOptions) => sendRequest<T>(path, init, owner);
  return {
  knowledge: (project: string) => request<Knowledge>(`/api/v1/knowledge?project_path=${encodeURIComponent(project)}`),
  checkpoint: (id: string) => request<{ status: string; changed: boolean; checkpoint: Checkpoint | null }>(`/api/v1/sessions/${id}/checkpoint`, { method: "POST", timeoutMs: 30_000 }),
  latestCheckpoint: (id: string) => request<Checkpoint | null>(`/api/v1/sessions/${id}/checkpoint`, { timeoutMs: 10_000 }),
  exportCheckpoint: (id: string, checkpoint: string, markdown: string) => request<Checkpoint>(`/api/v1/sessions/${id}/checkpoint/export`, { method: "POST", body: JSON.stringify({ checkpoint_id: checkpoint, markdown }), timeoutMs: 30_000 }),
  feedback: (id: string, feedback: Feedback) => request<Checkpoint>(`/api/v1/sessions/${id}/feedback`, { method: "POST", body: JSON.stringify(feedback), timeoutMs: 10_000 }),
  learningDraft: (id: string, provider?: string) => request<Lesson>(`/api/v1/sessions/${id}/learning-draft`, { method: "POST", body: JSON.stringify({ provider }), timeoutMs: 120_000 }),
  cleanCheckpoint: (id: string, provider?: string) => request<{ markdown: string }>(`/api/v1/sessions/${id}/checkpoint/clean`, { method: "POST", body: JSON.stringify({ provider }), timeoutMs: 120_000 }),
  approveLesson: (id: string, instruction: string, resolveConflicts: boolean) => request<Lesson>(`/api/v1/project-memory/drafts/${id}/approve`, { method: "POST", body: JSON.stringify({ instruction, resolve_conflicts: resolveConflicts }), timeoutMs: 30_000 }),
  rejectLesson: (id: string) => request<Lesson>(`/api/v1/project-memory/drafts/${id}/reject`, { method: "POST", timeoutMs: 10_000 }),
  knowledgePreflight: (project: string, category: string, scope: string[], task: string) => request<Preflight>("/api/v1/knowledge/preflight", { method: "POST", body: JSON.stringify({ project_path: project, category, scope, task }), timeoutMs: 10_000 }),
  learningProviders: () => request<{ id: string; label: string; configured: boolean; kind: string }[]>("/api/v1/knowledge/providers"),
  learningSettings: () => request<LearningSettings>("/api/v1/knowledge/provider-settings", { timeoutMs: 10_000 }),
  saveLearningConnection: (input: LearningConnectionInput) => request<LearningProvider>("/api/v1/knowledge/provider-settings", { method: "PUT", body: JSON.stringify(input), timeoutMs: 10_000 }),
  testLearningConnection: (input: LearningConnectionInput) => request<{ status: string; message: string }>("/api/v1/knowledge/provider-settings/test", { method: "POST", body: JSON.stringify(input), timeoutMs: 20_000 }),
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
  appendTerminalTranscript: (id: string, content: string) =>
    request<{ content: string }>(`/api/v1/sessions/${id}/terminal-transcript`, {
      method: "POST", body: JSON.stringify({ content }),
    }),
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
  contextWindow: (id: string, draft = "") =>
    request<ContextWindowReading>(`/api/v1/sessions/${id}/context-window?draft=${encodeURIComponent(draft)}`),
  crossRunConflicts: (id: string) =>
    request<CrossRunConflict[]>(`/api/v1/sessions/${id}/cross-conflicts`, {
      method: "POST",
    }),
  createSession: (input: {
    name: string;
    kind?: SessionKind;
    branch?: string;
    agent?: string;
    model?: string;
    autoCommit?: boolean;
    fromCommit?: string;
    projectPath?: string;
    worktree?: boolean;
    baseRef?: string;
    task?: string;
    scope?: string[];
    role?: string;
    skills?: string[];
    category?: string;
  }) =>
    request<Session>("/api/v1/sessions", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        kind: input.kind ?? "chat",
        branch: input.branch,
        agent: input.agent,
        model: input.model,
        auto_commit: input.autoCommit ?? false,
        from_commit: input.fromCommit,
        project_path: input.projectPath,
        worktree: input.worktree ?? false,
        base_ref: input.baseRef,
        task: input.task,
        scope: input.scope ?? [],
        role: input.role,
        skills: input.skills ?? [],
        category: input.category ?? "",
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
  deleteSession: (id: string, permanent = false, removeWorktree = true, forceWorktree = false) =>
    request<void>(
      `/api/v1/sessions/${id}?permanent=${permanent}&remove_worktree=${removeWorktree}&force_worktree=${forceWorktree}`,
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
  canvasViewport: (projectPath: string) => request<CanvasViewport>(`/api/v1/canvas/viewport?project_path=${encodeURIComponent(projectPath)}`),
  importCanvasSessions: (projectPath: string) => request<SpatialTeam[]>(`/api/v1/canvas/import-sessions?project_path=${encodeURIComponent(projectPath)}`, { method: 'POST' }),
  groupCanvasWorkers: (projectPath: string, name: string, taskIds: string[]) => request<SpatialTeam>('/api/v1/canvas/group-workers', { method: 'POST', body: JSON.stringify({ project_path: projectPath, name, task_ids: taskIds }) }),
  reorderCanvasWorkers: (teamId: string, taskIds: string[]) => request<SpatialTeam>(`/api/v1/teams/${teamId}/worker-order`, { method: 'PUT', body: JSON.stringify({ task_ids: taskIds }) }),
  librarySkills: (projectPath: string) => request<LibrarySkill[]>(`/api/v1/skills?project_path=${encodeURIComponent(projectPath)}`),
  proposeLibrarySkill: (projectPath: string, draft: Pick<LibrarySkill, 'title' | 'instruction' | 'evidence' | 'scope'> & { source_team?: string }) =>
    request<LibrarySkill>(`/api/v1/skills?project_path=${encodeURIComponent(projectPath)}`, { method: 'POST', body: JSON.stringify(draft) }),
  reviewLibrarySkill: (projectPath: string, skill: LibrarySkill, action: 'approve' | 'reject' | 'remove' | 'promote', instruction?: string) =>
    request<LibrarySkill>(`/api/v1/skills/${skill.origin}/${skill.id}/review?project_path=${encodeURIComponent(projectPath)}`, { method: 'POST', body: JSON.stringify({ action, instruction }) }),
  saveCanvasViewport: (projectPath: string, viewport: Pick<CanvasViewport, "x" | "y" | "zoom">) =>
    request<CanvasViewport>("/api/v1/canvas/viewport", { method: "PUT", body: JSON.stringify({ project_path: projectPath, ...viewport }) }),
  teams: (projectPath?: string) => request<SpatialTeam[]>(
    `/api/v1/teams${projectPath ? `?project_path=${encodeURIComponent(projectPath)}` : ""}`,
  ),
  spatialTeam: (id: string) => request<SpatialTeam>(`/api/v1/teams/${id}`),
  createSpatialTeam: (input: {
    name: string;
    projectPath: string;
    goal?: string;
    orchestratorAgent?: string;
    baseRef?: string;
    managedExecution?: boolean;
    maxActive?: number;
    allowedAgents?: string[];
    orchestratorModel?: string;
    workerModels?: Record<string, string>;
  }) => request<SpatialTeam>("/api/v1/teams", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      project_path: input.projectPath,
      goal: input.goal ?? "",
      orchestrator_agent: input.orchestratorAgent,
      base_ref: input.baseRef,
      managed_execution: input.managedExecution ?? false,
      max_active: input.maxActive ?? 4,
      allowed_agents: input.allowedAgents ?? ["codex", "claude"],
      orchestrator_model: input.orchestratorModel || null,
      worker_models: input.workerModels ?? {},
    }),
  }),
  updateSpatialTeam: (id: string, patch: Partial<Pick<Team, "name" | "goal" | "state" | "orchestrator_agent" | "orchestrator_session_id">>) =>
    request<SpatialTeam>(`/api/v1/teams/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  startOrchestrator: (id: string) => request<Session>(`/api/v1/teams/${id}/orchestrator/start`, { method: "POST" }),
  harnessModels: (agent: string) => request<{ models: { id: string; label: string }[]; source: string; message: string }>(`/api/v1/harnesses/${encodeURIComponent(agent)}/models`),
  integrateTeam: (id: string) => request(`/api/v1/teams/${id}/integrate`, { method: "POST" }),
  archiveSpatialTeam: (id: string) => request(`/api/v1/teams/${id}`, { method: "DELETE" }),
  teamPlan: (id: string) => request<TeamPlanRevision | null>(`/api/v1/teams/${id}/plan`),
  saveTeamPlan: (id: string, goal: string, tasks: TeamPlanTask[]) =>
    request<TeamPlanRevision>(`/api/v1/teams/${id}/plan`, {
      method: "PUT", body: JSON.stringify({ goal, tasks }),
    }),
  approveTeamPlan: (id: string) => request<SpatialTeam>(`/api/v1/teams/${id}/plan/approve`, { method: "POST" }),
  pauseSpatialTeam: (id: string) => request<SpatialTeam>(`/api/v1/teams/${id}/pause`, { method: "POST" }),
  resumeSpatialTeam: (id: string) => request<SpatialTeam>(`/api/v1/teams/${id}/resume`, { method: "POST" }),
  updateTeamLayout: (id: string, layout: Omit<CanvasLayout, "team_id" | "updated_at">) =>
    request<CanvasLayout>(`/api/v1/teams/${id}/layout`, { method: "PATCH", body: JSON.stringify(layout) }),
  attachTeamSkill: (id: string, skill: { skill_id: string; title: string; instruction: string; origin?: SkillLink["origin"]; task_id?: string; agent?: string }) =>
    request<SkillLink>(`/api/v1/teams/${id}/skills`, { method: "POST", body: JSON.stringify(skill) }),
  detachTeamSkill: (id: string, linkId: string) =>
    request<void>(`/api/v1/teams/${id}/skills/${linkId}`, { method: "DELETE" }),
  previewSpatialTeamMerge: (id: string) => request<{
    ready: boolean;
    unfinished: string[];
    tasks: Task[];
    changes: Array<{ task_id: string; title: string; status: string; gate_status: string | null; gate_output: string | null; files: Array<{ status: string; path: string }>; conflicts: string[] }>;
    checks: Array<{ task_id: string; command: string | null; status: string | null }>;
    requires_confirmation: boolean;
  }>(`/api/v1/teams/${id}/merge/preview`, { method: "POST" }),
  confirmSpatialTeamMerge: (id: string) => request<{ entries: MergeQueueEntry[]; completed?: boolean }>(`/api/v1/teams/${id}/merge/confirm`, { method: "POST" }),
  spatialTasks: (id: string) => request<Task[]>(`/api/v1/teams/${id}/tasks`),
  createSpatialTask: (teamId: string, input: TaskInput) => request<Task>(`/api/v1/teams/${teamId}/tasks`, { method: "POST", body: JSON.stringify(input) }),
  updateSpatialTask: (teamId: string, taskId: string, patch: Partial<TaskInput> & { status?: TaskStatus }) => request<Task>(`/api/v1/teams/${teamId}/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteSpatialTask: (teamId: string, taskId: string) => request<void>(`/api/v1/teams/${teamId}/tasks/${taskId}`, { method: "DELETE" }),
  launchSpatialTeam: (id: string) => request<Task[]>(`/api/v1/teams/${id}/launch`, { method: "POST" }),
  startSpatialTask: (teamId: string, taskId: string, agent?: string) => request<Task>(`/api/v1/teams/${teamId}/tasks/${taskId}/start`, { method: "POST", body: JSON.stringify({ agent }) }),
  stopSpatialTask: (teamId: string, taskId: string, note?: string) => request<Task>(`/api/v1/teams/${teamId}/tasks/${taskId}/stop`, { method: "POST", body: JSON.stringify({ note }) }),
  retrySpatialTask: (teamId: string, taskId: string, agent?: string) => request<Task>(`/api/v1/teams/${teamId}/tasks/${taskId}/retry`, { method: "POST", body: JSON.stringify({ agent }) }),
  completeSpatialTask: (teamId: string, taskId: string) => request<Task>(`/api/v1/teams/${teamId}/tasks/${taskId}/complete`, { method: "POST" }),
  gateSpatialTask: (teamId: string, taskId: string) => request<Task>(`/api/v1/teams/${teamId}/tasks/${taskId}/gate`, { method: "POST" }),
  approveSpatialTask: (teamId: string, taskId: string) => request<Task>(`/api/v1/teams/${teamId}/tasks/${taskId}/approve`, { method: "POST" }),
  rejectSpatialTask: (teamId: string, taskId: string, note: string) => request<Task>(`/api/v1/teams/${teamId}/tasks/${taskId}/reject`, { method: "POST", body: JSON.stringify({ note }) }),
  verifySpatialTask: (teamId: string, taskId: string, agent?: string) => request<Task>(`/api/v1/teams/${teamId}/tasks/${taskId}/verify`, { method: "POST", body: JSON.stringify({ agent }) }),
  spatialTeamMessages: (id: string, limit = 50) => request<TeamMessage[]>(`/api/v1/teams/${id}/messages?limit=${limit}`),
  postSpatialTeamMessage: (id: string, input: { body: string; kind?: TeamMessageKind; taskId?: string }) => request<TeamMessage>(`/api/v1/teams/${id}/messages`, { method: "POST", body: JSON.stringify({ body: input.body, kind: input.kind ?? "update", task_id: input.taskId }) }),
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
}
export const api = projectApi();

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
