import { lazy, Suspense } from "react";

import type { Session } from "@/lib/api";

/** xterm is heavy and only needed once a terminal pane exists. */
const TerminalPane = lazy(() => import("./TerminalPane"));

export type PaneLayout = "single" | "split" | "tiled";

export const LAYOUT_OPTIONS = [
  { value: "single" as const, label: "Single" },
  { value: "split" as const, label: "Split" },
  { value: "tiled" as const, label: "Tiled" },
];

export const LAYOUT_LIMIT: Record<PaneLayout, number> = { single: 1, split: 2, tiled: 4 };

/** Open runs, in the order they were opened. */
export function openSessions(sessions: Session[], openIds: string[]): Session[] {
  return openIds
    .map((id) => sessions.find((session) => session.id === id))
    .filter((session): session is Session => Boolean(session));
}

/**
 * The panes the current layout actually shows (the rest stay mounted, hidden).
 * The active run comes first, so starting or selecting a run never leaves its
 * terminal sliced out of a split/tiled layout by older panes.
 */
export function visibleSessions(
  open: Session[],
  layout: PaneLayout,
  activeId: string | null,
): Session[] {
  if (layout === "single") return open.filter((session) => session.id === activeId).slice(0, 1);
  const active = open.find((session) => session.id === activeId);
  const rest = open.filter((session) => session.id !== activeId);
  return [...(active ? [active] : []), ...rest].slice(0, LAYOUT_LIMIT[layout]);
}

/**
 * The pane canvas shared by Single and Team mode: every open run is a live
 * terminal, and panes stay mounted (hidden) when the layout does not show them
 * so processes and scrollback survive.
 */
export default function PaneCanvas({
  sessions,
  openIds,
  activeId,
  layout,
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
  activeId: string | null;
  layout: PaneLayout;
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
  const open = openSessions(sessions, openIds);
  if (open.length === 0) return null;
  const shownIds = new Set(visibleSessions(open, layout, activeId).map((session) => session.id));

  return (
    <div className="cg-pane-canvas" data-layout={layout}>
      <Suspense fallback={null}>
        {open.map((session) => (
          <TerminalPane
            key={session.id}
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
        ))}
      </Suspense>
    </div>
  );
}
