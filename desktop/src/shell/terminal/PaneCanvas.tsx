import { lazy, Suspense, useRef } from "react";

import { uniqueSessions } from "./sessionState";
import ErrorBoundary from "../../ErrorBoundary";
import type { Session } from "@/lib/api";

/** xterm is heavy and only needed once a terminal pane exists. */
const TerminalPane = lazy(() => import("./TerminalPane"));

export type PaneLayout = "single" | "split" | "tiled";

/** Layout follows the number of open terminals; there is no manual mode switch. */
export function layoutForCount(count: number): PaneLayout {
  if (count <= 1) return "single";
  if (count === 2) return "split";
  return "tiled";
}

/** Open runs, in the order they were opened. */
export function openSessions(sessions: Session[], openIds: string[]): Session[] {
  return [...new Set(openIds)]
    .map((id) => sessions.find((session) => session.id === id))
    .filter((session): session is Session => Boolean(session));
}

/**
 * The panes the current layout actually shows (the rest stay mounted, hidden).
 * Tiled panes keep their opening order so selecting a terminal does not move
 * the scrollable grid. Split puts the active run first so it stays visible.
 */
export function visibleSessions(
  open: Session[],
): Session[] {
  return open;
}

/**
 * The pane canvas shared by Single and Team mode: every open run is a live
 * terminal, and panes stay mounted (hidden) when the layout does not show them
 * so processes and scrollback survive.
 */
export default function PaneCanvas({
  sessions,
  openIds,
  theme,
  kickoff,
  taskIds,
  onSelect,
  onClose,
  onStaged,
  onStatus,
}: {
  sessions: Session[];
  openIds: string[];
  theme: "dark" | "light";
  /** Session id → one-line briefing typed into that terminal once it is up. */
  kickoff?: Record<string, string>;
  /** Session id → the team task it owns, exported as CONTEXTGIT_TASK. */
  taskIds?: Record<string, string>;
  onSelect: (session: Session) => void;
  onClose: (session: Session) => void;
  onStaged: () => void;
  onStatus: () => void;
}) {
  const retained = useRef(new Map<string, Session>());
  const ids = new Set(openIds);
  for (const id of retained.current.keys()) if (!ids.has(id)) retained.current.delete(id);
  for (const session of uniqueSessions(sessions)) if (ids.has(session.id)) retained.current.set(session.id, session);
  const open = openSessions([...retained.current.values()], openIds);
  if (open.length === 0) return null;
  const layout = layoutForCount(open.length);
  const shownIds = new Set(visibleSessions(open).map((session) => session.id));

  return (
    <div className="cg-pane-canvas" data-layout={layout}>
      {open.map((session) => (
        <ErrorBoundary key={session.id} feature={`${session.name} terminal`}>
          <Suspense fallback={null}>
            <TerminalPane
              session={session}
              visible={shownIds.has(session.id)}
              theme={theme}
              initialInput={kickoff?.[session.id]}
              taskId={taskIds?.[session.id]}
              onActivate={() => onSelect(session)}
              onClose={() => onClose(session)}
              onStaged={onStaged}
              onStatus={onStatus}
            />
          </Suspense>
        </ErrorBoundary>
      ))}
    </div>
  );
}
