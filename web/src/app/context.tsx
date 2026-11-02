/**
 * App-wide state for the web shell: one `useWorkbenchState` instance (sessions,
 * projects, active project) plus hash-based navigation, so reload and the
 * browser's back button keep the current view.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useWorkbenchState } from "../shell/useWorkbenchState";

export type AppView =
  | { kind: "home" }
  | { kind: "session"; sessionId: string }
  | { kind: "canvas" }
  | { kind: "skills" }
  | { kind: "memory" }
  | { kind: "settings" };

export type Workbench = ReturnType<typeof useWorkbenchState>;

interface AppContextValue {
  wb: Workbench;
  view: AppView;
  go: (view: AppView) => void;
  /** The sessions drawer next to the rail. */
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function parseHash(hash: string): AppView {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  switch (parts[0]) {
    case "session": return parts[1] ? { kind: "session", sessionId: decodeURIComponent(parts[1]) } : { kind: "home" };
    case "canvas": return { kind: "canvas" };
    case "skills": return { kind: "skills" };
    case "memory": return { kind: "memory" };
    case "settings": return { kind: "settings" };
    default: return { kind: "home" };
  }
}

export function viewHash(view: AppView): string {
  return view.kind === "session" ? `#/session/${encodeURIComponent(view.sessionId)}` : view.kind === "home" ? "#/" : `#/${view.kind}`;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const wb = useWorkbenchState();
  const [view, setView] = useState<AppView>(() => parseHash(window.location.hash));
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const onHash = () => setView(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = useCallback((next: AppView) => {
    const hash = viewHash(next);
    // Keep the query string (API address and launch token) untouched.
    if (window.location.hash !== hash) window.location.hash = hash;
    setView(next);
  }, []);

  const value = useMemo(() => ({ wb, view, go, drawerOpen, setDrawerOpen }), [wb, view, go, drawerOpen]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside <AppProvider>.");
  return value;
}
