import { useSyncExternalStore } from "react";

/** One page in the browser's history or bookmarks. */
export interface BrowserEntry {
  url: string;
  title: string;
  at: number;
}

const HISTORY_KEY = "cg.browser.history";
const BOOKMARKS_KEY = "cg.browser.bookmarks";
const HISTORY_LIMIT = 300;

function load(key: string): BrowserEntry[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BrowserEntry[]) : [];
  } catch {
    return [];
  }
}

function save(key: string, value: BrowserEntry[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable; the session still works.
  }
}

// Module-level store so the view and the rail see the same data without
// threading it through the whole shell.
let history = load(HISTORY_KEY);
let bookmarks = load(BOOKMARKS_KEY);
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Remember a page, newest first, one entry per URL. */
export function recordVisit(url: string, title: string): void {
  if (!url || url === "about:blank") return;
  history = [
    { url, title: title || url, at: Date.now() },
    ...history.filter((entry) => entry.url !== url),
  ].slice(0, HISTORY_LIMIT);
  save(HISTORY_KEY, history);
  emit();
}

/** Star/unstar a page. */
export function toggleBookmark(url: string, title: string): void {
  if (!url) return;
  const exists = bookmarks.some((entry) => entry.url === url);
  bookmarks = exists
    ? bookmarks.filter((entry) => entry.url !== url)
    : [{ url, title: title || url, at: Date.now() }, ...bookmarks];
  save(BOOKMARKS_KEY, bookmarks);
  emit();
}

export function removeBookmark(url: string): void {
  bookmarks = bookmarks.filter((entry) => entry.url !== url);
  save(BOOKMARKS_KEY, bookmarks);
  emit();
}

export function clearHistory(): void {
  history = [];
  save(HISTORY_KEY, history);
  emit();
}

export function useBrowserLibrary(): {
  history: BrowserEntry[];
  bookmarks: BrowserEntry[];
} {
  const historyEntries = useSyncExternalStore(subscribe, () => history);
  const bookmarkEntries = useSyncExternalStore(subscribe, () => bookmarks);
  return { history: historyEntries, bookmarks: bookmarkEntries };
}
