import type { SessionKind } from "@/lib/api";

/** One pane the user closed, kept so it can be reopened from Storage. */
export interface ClosedPane {
  id: string;
  name: string;
  kind: SessionKind;
  at: string;
}

const KEY = "cg-closed-panes";
const LIMIT = 25;

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
function openKey(): string {
  const status = window.contextgit?.getStatus().status;
  if (status?.state === "ready" && status.repoId) verifiedRepoId = status.repoId;
  return `cg-open-panes:${verifiedRepoId ?? "unverified"}`;
}

/** The run ids that were open when the app last unloaded. */
export function loadOpenPanes(): string[] {
  try {
    const raw = window.localStorage.getItem(openKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? [...new Set(parsed.filter((id): id is string => typeof id === "string"))] : [];
  } catch {
    return [];
  }
}

/** Remember the open run ids so they can be restored after a reload. */
export function saveOpenPanes(ids: string[]): void {
  try {
    window.localStorage.setItem(openKey(), JSON.stringify([...new Set(ids)]));
  } catch {
    // ignore storage failures
  }
}
