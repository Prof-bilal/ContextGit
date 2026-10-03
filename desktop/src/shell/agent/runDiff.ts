import type { AgentRun, NamedAgent } from "../../mock/fixtures";

export type DiffChange = "added" | "changed" | "removed";

export interface DiffEntry {
  change: DiffChange;
  kind: string;
  text: string;
}

/**
 * What one run changed in the context DAG, derived from the run and the agent's
 * memory so the diff always matches what the agent actually knows. Mock data.
 */
export function runDiff(run: AgentRun, agent: NamedAgent): DiffEntry[] {
  const entries: DiffEntry[] = [];

  for (const decision of agent.memory.decisions.slice(0, 2)) {
    entries.push({ change: "added", kind: "decision", text: decision });
  }
  for (const fact of agent.memory.facts.slice(0, 1)) {
    entries.push({ change: "added", kind: "fact", text: fact });
  }
  for (const deadEnd of agent.memory.deadEnds.slice(0, 1)) {
    entries.push({ change: "added", kind: "dead end", text: deadEnd });
  }

  entries.push({
    change: "changed",
    kind: "branch",
    text: `${run.branches[0] ?? "main"} head advanced · ${run.summary}`,
  });

  const dropped = /drop/i.test(run.summary);
  if (dropped) {
    entries.push({
      change: "removed",
      kind: "stale",
      text: "benchmark numbers from the v0 draft (superseded)",
    });
  }
  if (run.status === "error") {
    entries.push({
      change: "removed",
      kind: "attempt",
      text: "the failed path only — nothing else was written",
    });
  }

  return entries;
}

export function diffCounts(entries: DiffEntry[]): { added: number; changed: number; removed: number } {
  return {
    added: entries.filter((entry) => entry.change === "added").length,
    changed: entries.filter((entry) => entry.change === "changed").length,
    removed: entries.filter((entry) => entry.change === "removed").length,
  };
}
