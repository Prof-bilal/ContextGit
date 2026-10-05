/**
 * Sample data for the one tab still on fixtures (Agent). Chat, Code and Git all
 * read the real API now; Agent still needs its capture layer (plan.md Phase 10).
 */
import type { SessionStatus } from "@/lib/api";

export interface AgentRun {
  id: string;
  agentId: string;
  startedAt: string;
  durationMin: number;
  status: SessionStatus;
  summary: string;
  tokens: number;
  branches: string[];
}

export interface NamedAgent {
  id: string;
  name: string;
  monogram: string;
  hue: string;
  /** Clay-avatar seed. Falls back to the id, so even a new agent gets a creature. */
  seed?: string;
  brief: string;
  memory: {
    decisions: string[];
    facts: string[];
    deadEnds: string[];
    openQuestions: string[];
  };
  skills: string[];
  routine: {
    enabled: boolean;
    cron: string;
    human: string;
    nextRuns: string[];
  };
  runs: AgentRun[];
}

/**
 * First-party agents: small recurring jobs that maintain the context layer itself
 * (compact, warn, audit, record). Capability features (budget, permissions,
 * observability) are app surfaces, not agents.
 */
export const NAMED_AGENTS: NamedAgent[] = [
  {
    id: "agent_context_curator",
    name: "Context Curator",
    monogram: "C",
    hue: "claude",
    brief:
      "Nightly, read the day's commits on every branch, compact stale context, pin what is still referenced, and propose drops with a reason for each. Never drop a dead end.",
    memory: {
      decisions: ["Compaction never drops a dead end", "Drops are proposals until reviewed"],
      facts: ["Branch context lives in .contextgit/context.md", "Budgets are per model"],
      deadEnds: ["An aggressive compaction pass once dropped a fact still in use — always show receipts"],
      openQuestions: ["Per-branch or per-repo compaction?"],
    },
    skills: ["read-dag", "summarize-commits", "budget-packet"],
    routine: {
      enabled: true,
      cron: "0 3 * * *",
      human: "Daily at 03:00",
      nextRuns: ["Sat 3 Oct, 03:00", "Sun 4 Oct, 03:00"],
    },
    runs: [
      { id: "ar_c1", agentId: "claude", startedAt: "2026-10-02T03:00:00Z", durationMin: 5, status: "done", summary: "Compacted 4 branches · 2 pinned · 3 drops proposed", tokens: 21400, branches: ["main", "fix/subscription-guard"] },
      { id: "ar_c2", agentId: "claude", startedAt: "2026-10-01T03:00:00Z", durationMin: 6, status: "done", summary: "Dropped a stale benchmark note, kept both dead ends", tokens: 19800, branches: ["main"] },
    ],
  },
  {
    id: "agent_dead_end_warden",
    name: "Dead-End Warden",
    monogram: "W",
    hue: "codex",
    brief:
      "Watch for new work that repeats an attempt already recorded as a dead end. Surface the failure reason before the run spends tokens on it again.",
    memory: {
      decisions: ["Warnings are advisory, never blocking", "Every dead end keeps its failure reason"],
      facts: ["Dead ends are kind:note commits", "Warnings are injected, not pasted into the prompt"],
      deadEnds: [],
      openQuestions: ["Warn at branch start, or at prompt submit?"],
    },
    skills: ["search-history", "list-dead-ends", "inject-context"],
    routine: {
      enabled: true,
      cron: "0 9 * * 1-5",
      human: "Weekdays at 09:00",
      nextRuns: ["Mon 6 Oct, 09:00", "Tue 7 Oct, 09:00"],
    },
    runs: [
      { id: "ar_w1", agentId: "codex", startedAt: "2026-10-02T09:00:00Z", durationMin: 2, status: "done", summary: "Flagged 1 repeat attempt (redis sessions) before it started", tokens: 6400, branches: ["exp/redis-sessions"] },
      { id: "ar_w2", agentId: "codex", startedAt: "2026-10-01T09:00:00Z", durationMin: 1, status: "done", summary: "No repeats found across 6 branches", tokens: 3100, branches: [] },
    ],
  },
  {
    id: "agent_drift_sentinel",
    name: "Drift Sentinel",
    monogram: "S",
    hue: "opencode",
    brief:
      "For every long-running run, compare the current plan against the goal frozen at run start. Flag shortcutting, reward hacking, and quiet scope changes with evidence.",
    memory: {
      decisions: ["Flags are evidence, not verdicts", "The original goal is frozen when a run starts"],
      facts: ["Goals are recorded on the session branch", "Drift is measured against the stated plan, not keywords"],
      deadEnds: ["Keyword matching produced false drifts — use the stated plan"],
      openQuestions: ["At what drift score should a run pause?"],
    },
    skills: ["read-dag", "compare-branches", "evaluate"],
    routine: {
      enabled: true,
      cron: "0 */4 * * *",
      human: "Every 4 hours",
      nextRuns: ["Today, 20:00", "Tomorrow, 00:00"],
    },
    runs: [
      { id: "ar_s1", agentId: "opencode", startedAt: "2026-10-02T12:00:00Z", durationMin: 3, status: "running", summary: "Checking 2 active runs for scope drift", tokens: 11200, branches: ["fix/subscription-guard", "test/cancelled-tier-e2e"] },
      { id: "ar_s2", agentId: "opencode", startedAt: "2026-10-02T08:00:00Z", durationMin: 3, status: "done", summary: "1 flag: run widened to a second package without saying so", tokens: 10400, branches: ["refactor/merge-engine"] },
    ],
  },
  {
    id: "agent_belief_auditor",
    name: "Belief Auditor",
    monogram: "B",
    hue: "gemini",
    brief:
      "Scan accumulated memory for poisoned, stale, or contradictory beliefs. Propose a fix with the evidence that triggered it — a one-off injected instruction must not become a durable belief.",
    memory: {
      decisions: ["Every stored belief keeps its provenance", "Contradictions resolve by newest evidence, not by use"],
      facts: ["Beliefs are extracted from commits", "Provenance points at a commit id"],
      deadEnds: [],
      openQuestions: ["Should a quarantined belief stay visible to agents?"],
    },
    skills: ["read-dag", "scan-memory", "diff-branches"],
    routine: {
      enabled: false,
      cron: "0 4 * * 0",
      human: "Sundays at 04:00 (paused)",
      nextRuns: [],
    },
    runs: [
      { id: "ar_b1", agentId: "gemini", startedAt: "2026-09-28T04:00:00Z", durationMin: 7, status: "done", summary: "2 beliefs quarantined · 1 contradiction resolved by newest commit", tokens: 16200, branches: ["main", "exp/redis-sessions"] },
      { id: "ar_b2", agentId: "gemini", startedAt: "2026-09-21T04:00:00Z", durationMin: 6, status: "done", summary: "No poisoned beliefs; 1 stale fact re-measured", tokens: 13900, branches: ["main"] },
    ],
  },
  {
    id: "agent_flight_recorder",
    name: "Flight Recorder",
    monogram: "F",
    hue: "ollama",
    brief:
      "Record every captured turn into a replayable log, diff each checkpoint against the last, and publish a nightly digest with undo-to-here points.",
    memory: {
      decisions: ["Recordings are append-only", "Replay is per session, diff is per branch"],
      facts: ["Capture sources are hook / tail / pty", "Commits are content-addressed"],
      deadEnds: ["Replay broke when raw ANSI was stored — strip before recording"],
      openQuestions: ["Keep every turn, or only checkpoints?"],
    },
    skills: ["read-dag", "summarize-commits", "export-branch"],
    routine: {
      enabled: true,
      cron: "0 23 * * *",
      human: "Daily at 23:00",
      nextRuns: ["Today, 23:00", "Tomorrow, 23:00"],
    },
    runs: [
      { id: "ar_f1", agentId: "ollama", startedAt: "2026-10-01T23:00:00Z", durationMin: 4, status: "done", summary: "Digest: 41 turns recorded, 6 undo points, 0 gaps", tokens: 8800, branches: ["main"] },
      { id: "ar_f2", agentId: "ollama", startedAt: "2026-09-30T23:00:00Z", durationMin: 5, status: "done", summary: "Digest: 33 turns, 4 undo points, 1 capture gap (pty)", tokens: 7600, branches: ["main"] },
    ],
  },
];
