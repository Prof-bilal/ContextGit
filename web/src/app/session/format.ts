import type { SessionStatus } from "@/shared/api";

export const STATUS_TEXT: Record<SessionStatus, string> = {
  running: "Running",
  idle: "Idle",
  done: "Finished",
  error: "Error",
};

export function baseName(path: string | null | undefined): string {
  if (!path) return "";
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function absoluteTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function relativeTime(iso: string, now = Date.now()): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "";
  const seconds = Math.round((now - time) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
