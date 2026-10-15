import { useSyncExternalStore } from "react";
import type { PrimaryTabId } from "./TopNav";

let state = { tab: "code" as PrimaryTabId, storageOpen: false };
const listeners = new Set<() => void>();
export const shellActivity = {
  read: () => state,
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  update(next: Partial<typeof state>) {
    if (Object.entries(next).every(([key, value]) => state[key as keyof typeof state] === value)) return;
    state = { ...state, ...next };
    listeners.forEach(listener => listener());
  },
};
export const useShellActivity = () => useSyncExternalStore(shellActivity.subscribe, shellActivity.read);
