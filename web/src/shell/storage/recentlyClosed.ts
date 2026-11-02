import type { SessionKind } from "@/shared/api";
import { projectRuntime } from "../../../shared/projectRuntime";

/** One pane the user closed, kept so it can be reopened from Storage. */
export interface ClosedPane {
  id: string;
  name: string;
  kind: SessionKind;
  at: string;
}

const KEY = "cg-closed-panes";
const LIMIT = 25;

export function loadDismissedAgentTabs(path: string | null = projectRuntime.read().path): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(`cg-dismissed-agent-tabs:${path}`) ?? window.localStorage.getItem("cg-dismissed-agent-tabs") ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch { return []; }
}

export function saveDismissedAgentTabs(ids: string[], path: string | null): void {
  try { window.localStorage.setItem(`cg-dismissed-agent-tabs:${path}`, JSON.stringify(ids)); }
  catch { /* Storage may be unavailable. */ }
}

/** Recently closed panes, newest first. Never throws (storage may be unavailable). */
export function loadClosed(): ClosedPane[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ClosedPane[]) : [];
  } catch {
    return [];
  }
}

/** Record a closed pane and return the updated list. */
export function pushClosed(entry: ClosedPane): ClosedPane[] {
  const next = [entry, ...loadClosed().filter((item) => item.id !== entry.id)].slice(0, LIMIT);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore storage failures
  }
  return next;
}

/** Drop one closed pane (e.g. after it was restored). */
export function removeClosed(id: string): ClosedPane[] {
  const next = loadClosed().filter((item) => item.id !== id);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore storage failures
  }
  return next;
}

/** Forget every closed pane. */
export function clearClosed(): ClosedPane[] {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore storage failures
  }
  return [];
}

let verifiedRepoId: string | undefined;
function openKey(path: string | null = projectRuntime.read().path): string {
  return `cg-open-panes:project:${path ?? "none"}`;
}

/** The run ids that were open when the app last unloaded. */
export function loadOpenPanes(path?: string): string[] {
  try {
    const raw = window.localStorage.getItem(openKey(path)) ?? window.localStorage.getItem("cg-open-panes:unverified");
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? [...new Set(parsed.filter((id): id is string => typeof id === "string"))] : [];
  } catch {
    return [];
  }
}

/** Remember the open run ids so they can be restored after a reload. */
export function saveOpenPanes(ids: string[], path?: string): void {
  try {
    window.localStorage.setItem(openKey(path), JSON.stringify([...new Set(ids)]));
  } catch {
    // ignore storage failures
  }
}
