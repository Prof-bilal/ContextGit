export type Role = "system" | "user" | "assistant" | "tool";
export type CommitKind = "root" | "normal" | "merge" | "note";

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
}

export interface RepoSnapshot {
  current_branch: string;
  branches: Branch[];
  commits: Commit[];
  tags: Array<{ name: string; commit_id: string; label: string | null }>;
}

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

// Electron preload injects the backend port; the web build falls back to env/default.
const bridge = typeof window !== "undefined"
  ? (window as { contextgit?: { apiBase?: string } }).contextgit
  : undefined;
const envBase = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_CONTEXTGIT_API : undefined;
const base = bridge?.apiBase ?? envBase ?? "http://127.0.0.1:8000";

export type SessionKind = "chat" | "terminal";
export type SessionStatus = "idle" | "running" | "done" | "error";

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
  task: string | null;
  scope: string[];
  created_at: string;
  updated_at: string;
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String(body.error)
        : `API request failed (${response.status})`;
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  snapshot: () => request<RepoSnapshot>("/api/v1/repo"),
  commits: (branch: string) =>
    request<CommitResponse[]>(`/api/v1/commits?branch=${encodeURIComponent(branch)}`),
  context: (commitId: string) =>
    request<Message[]>(`/api/v1/context?commit_id=${encodeURIComponent(commitId)}`),
  diff: (a: string, b: string) =>
    request<Diff>(`/api/v1/diff?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`),
  createBranch: (name: string, fromCommit: string) =>
    request<Branch>("/api/v1/branches", {
      method: "POST",
      body: JSON.stringify({ name, from_commit: fromCommit }),
    }),
  deleteBranch: (name: string) =>
    request<void>(`/api/v1/branches?name=${encodeURIComponent(name)}`, { method: "DELETE" }),
  mergePreview: (source: string, into: string) =>
    request<MergePreview>("/api/v1/merge/preview", {
      method: "POST",
      body: JSON.stringify({ source, into }),
    }),
  mergeApply: (preview: MergePreview, resolutions: Record<string, string>, summary: string) =>
    request<CommitResponse>("/api/v1/merge/apply", {
      method: "POST",
      body: JSON.stringify({ preview, resolutions, summary }),
    }),
  compare: (prompt: string, branchA: string, branchB: string, model: string) =>
    request<CompareResult>("/api/v1/compare", {
      method: "POST",
      body: JSON.stringify({ prompt, branch_a: branchA, branch_b: branchB, model }),
    }),
  // ---------- sessions (parallel AI runs) ----------
  sessions: () => request<Session[]>("/api/v1/sessions"),
  workspace: (id: string) => request<WorkspaceStatus>(`/api/v1/sessions/${id}/workspace`),
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
  sessionContext: (id: string) => request<{ text: string }>(`/api/v1/sessions/${id}/context`),
  crossRunConflicts: (id: string) =>
    request<CrossRunConflict[]>(`/api/v1/sessions/${id}/cross-conflicts`, { method: "POST" }),
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
  deleteSession: (id: string) =>
    request<void>(`/api/v1/sessions/${id}`, { method: "DELETE" }),
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
};

export async function streamChat(
  input: { prompt: string; branch: string; commitId: string; model: string },
  onToken: (text: string) => void,
  signal?: AbortSignal,
): Promise<{ answer: string; commitId: string }> {
  const response = await fetch(`${base}/api/v1/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      prompt: input.prompt,
      branch: input.branch,
      commit_id: input.commitId,
      model: input.model,
    }),
    signal,
  });
  if (!response.ok || !response.body) throw new Error(`Chat request failed (${response.status})`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  let commitId = "";
  let done = false;
  while (!done) {
    const chunk = await reader.read();
    done = chunk.done;
    buffer += decoder.decode(chunk.value, { stream: !done });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      const eventName = event.split("\n").find((line) => line.startsWith("event: "))?.slice(7);
      const dataLine = event.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
      if (!dataLine) continue;
      const data = JSON.parse(dataLine) as { text?: string; error?: string; commit_id?: string };
      if (eventName === "token" && data.text) {
        answer += data.text;
        onToken(data.text);
      } else if (eventName === "done") {
        commitId = data.commit_id ?? "";
      } else if (eventName === "error") {
        throw new Error(data.error ?? "Chat stream failed");
      }
    }
  }
  if (!commitId) throw new Error("Chat ended without a commit id");
  return { answer, commitId };
}
