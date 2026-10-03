import type { NamedAgent } from "../../mock/fixtures";

/**
 * Draft for creating or editing a first-party agent — what it should do, which
 * skills it may use, when it runs, and what its clay creature looks like.
 */
export interface MissionDraft {
  name: string;
  mission: string;
  skills: string[];
  cron: string;
  enabled: boolean;
  /** Clay-avatar colour key and seed, so a new agent gets its own creature. */
  hue: string;
  seed: string;
}

export const AGENT_HUES = ["claude", "codex", "opencode", "gemini", "aider", "ollama"];

export const DEFAULT_DRAFT: MissionDraft = {
  name: "",
  mission: "",
  skills: ["read-dag"],
  cron: "0 9 * * *",
  enabled: true,
  hue: "claude",
  seed: "new-agent",
};

export function draftFrom(agent: NamedAgent): MissionDraft {
  return {
    name: agent.name,
    mission: agent.brief,
    skills: agent.skills,
    cron: agent.routine.cron,
    enabled: agent.routine.enabled,
    hue: agent.hue,
    seed: agentSeed(agent),
  };
}

/** Stable avatar seed for an agent (falls back to the id). */
export function agentSeed(agent: NamedAgent): string {
  return agent.seed ?? agent.id;
}

export function newSeed(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 20) || "agent";
  return `${slug}-${Math.random().toString(36).slice(2, 8)}`;
}

export const SKILL_CATALOG = [
  "read-dag",
  "summarize-commits",
  "search-history",
  "inject-context",
  "compare-branches",
  "diff-branches",
  "scan-memory",
  "list-dead-ends",
  "budget-packet",
  "export-branch",
  "evaluate",
  "web-search",
];

export const SCHEDULES: Array<{ cron: string; human: string }> = [
  { cron: "0 * * * *", human: "Hourly" },
  { cron: "0 3 * * *", human: "Daily at 03:00" },
  { cron: "0 9 * * 1-5", human: "Weekdays at 09:00" },
  { cron: "0 17 * * 5", human: "Fridays at 17:00" },
  { cron: "0 4 * * 0", human: "Sundays at 04:00" },
];

export function humanSchedule(cron: string): string {
  return SCHEDULES.find((entry) => entry.cron === cron)?.human ?? cron;
}
