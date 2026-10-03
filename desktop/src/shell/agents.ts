/**
 * Agent CLI metadata for the workspace UI. `id` doubles as the PTY preset name
 * (see desktop/electron/pty.ts) and as the `data-agent` key for the monogram hue.
 */
export interface AgentInfo {
  id: string;
  label: string;
  monogram: string;
}

export const AGENTS: AgentInfo[] = [
  { id: "claude", label: "Claude Code", monogram: "C" },
  { id: "codex", label: "Codex", monogram: "X" },
  { id: "opencode", label: "OpenCode", monogram: "O" },
  { id: "gemini", label: "Gemini CLI", monogram: "G" },
  { id: "aider", label: "Aider", monogram: "A" },
  { id: "ollama", label: "Ollama", monogram: "L" },
  { id: "shell", label: "Shell", monogram: "$" },
];

export const AGENT_BY_ID: Record<string, AgentInfo> = Object.fromEntries(
  AGENTS.map((agent) => [agent.id, agent]),
);

export const DEFAULT_AGENT = "claude";

/** Label for an arbitrary session.agent value (falls back to the raw string). */
export function agentLabel(agent: string | null): string {
  if (!agent) return "Shell";
  return AGENT_BY_ID[agent]?.label ?? agent;
}

export function agentMonogram(agent: string | null): string {
  if (!agent) return "$";
  return AGENT_BY_ID[agent]?.monogram ?? agent.slice(0, 1).toUpperCase();
}
