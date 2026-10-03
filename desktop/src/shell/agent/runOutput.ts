import type { AgentRun } from "../../mock/fixtures";

export type RunStepKind = "plan" | "read" | "act" | "note" | "write" | "result" | "error";

export interface RunStep {
  at: string;
  kind: RunStepKind;
  text: string;
}

const stamp = (base: number, offsetSec: number) =>
  new Date(base + offsetSec * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

/** Stable short id for a mock artifact (commit-ish). */
export function shortHash(input: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(16).padStart(8, "0").slice(0, 7);
}

/**
 * Mock output for a run, derived from its own fields so the log always matches
 * the summary / duration / tokens shown in the row. Sample data — no backend.
 */
export function runSteps(run: AgentRun): RunStep[] {
  const base = new Date(run.startedAt).getTime();
  const scope = run.branches.length > 0 ? run.branches.join(", ") : "main";
  const steps: RunStep[] = [
    { at: stamp(base, 0), kind: "plan", text: `Scanned commits on ${scope}` },
    {
      at: stamp(base, 3),
      kind: "read",
      text: `Reconstructed context · ${(run.tokens / 1000).toFixed(1)}k tokens of budget`,
    },
    { at: stamp(base, 9), kind: "act", text: run.summary },
  ];

  if (run.status === "running") {
    steps.push({ at: stamp(base, 14), kind: "act", text: "Still working — nothing written yet" });
    return steps;
  }
  if (run.status === "error") {
    steps.push({
      at: stamp(base, 12),
      kind: "error",
      text: "Aborted — nothing was written to the DAG",
    });
    return steps;
  }

  steps.push({ at: stamp(base, 13), kind: "note", text: "Wrote decisions and facts · dead ends kept" });
  steps.push({ at: stamp(base, 16), kind: "write", text: `Checkpoint created on ${scope}` });
  steps.push({
    at: stamp(base, 17),
    kind: "result",
    text: `Done in ${run.durationMin}m · ${(run.tokens / 1000).toFixed(1)}k tokens`,
  });
  return steps;
}
