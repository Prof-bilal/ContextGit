/**
 * Agent CLI metadata for the workspace UI. The canonical list lives in
 * desktop/shared/harnesses.ts (shared with the Electron main process); this
 * module exposes the UI-facing subset.
 */
import { DEFAULT_HARNESS, HARNESSES } from "../../shared/harnesses";

export interface AgentInfo {
  id: string;
  label: string;
  monogram: string;
}

export const AGENTS: AgentInfo[] = HARNESSES.map(({ id, label, monogram }) => ({
  id,
  label,
  monogram,
}));

export const AGENT_BY_ID: Record<string, AgentInfo> = Object.fromEntries(
  AGENTS.map((agent) => [agent.id, agent]),
);

export const DEFAULT_AGENT = DEFAULT_HARNESS;

/** Label for an arbitrary session.agent value (falls back to the raw string). */
export function agentLabel(agent: string | null): string {
  if (!agent) return "Shell";
  return AGENT_BY_ID[agent]?.label ?? agent;
}

export function agentMonogram(agent: string | null): string {
  if (!agent) return "$";
  return AGENT_BY_ID[agent]?.monogram ?? agent.slice(0, 1).toUpperCase();
}
