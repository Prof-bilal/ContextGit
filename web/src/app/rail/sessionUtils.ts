/** Small helpers shared by the rail, the sessions drawer and the home screen. */
import type { Session } from "@/shared/api";
import { harnessFor } from "@/shared/harnesses";

/** Fired on `window` to ask the home screen to focus its prompt. */
export const FOCUS_PROMPT_EVENT = "contextgit:focus-prompt";

export function requestPromptFocus() {
  // Let the route change render Home first.
  window.setTimeout(() => window.dispatchEvent(new Event(FOCUS_PROMPT_EVENT)), 0);
}

/** Live terminal sessions of one project, newest activity first. */
export function projectTerminalSessions(sessions: Session[], projectPath: string | null): Session[] {
  if (!projectPath) return [];
  return sessions
    .filter(session => session.kind === "terminal" && session.project_path === projectPath && !session.deleted_at)
    .sort((a, b) => timeOf(b.updated_at || b.created_at) - timeOf(a.updated_at || a.created_at));
}

function timeOf(iso: string | null | undefined): number {
  const value = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(value) ? 0 : value;
}

/** "just now", "5m ago", "3h ago", "2d ago", then a short date. */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  const at = timeOf(iso);
  if (!at) return "";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function agentLabel(agent: string | null | undefined): string {
  return harnessFor(agent ?? "shell")?.label ?? agent ?? "Shell";
}

export function agentMonogram(agent: string | null | undefined): string {
  return harnessFor(agent ?? "shell")?.monogram ?? "$";
}

/** Folder name of an absolute path (Windows or POSIX). */
export function folderName(path: string | null | undefined): string {
  if (!path) return "";
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export const STATUS_LABEL: Record<Session["status"], string> = {
  running: "Running",
  idle: "Idle",
  done: "Done",
  error: "Error",
};
