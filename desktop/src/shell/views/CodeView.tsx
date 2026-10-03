import { lazy, Suspense, useState } from "react";
import { LuPlus } from "react-icons/lu";

import type { FleetEntry, Session } from "@/lib/api";
import type { Workspace } from "../../../shared/workspace";
import { Chip, MiniSeg } from "../primitives";

// xterm is heavy and only needed once a terminal pane exists.
const TerminalPane = lazy(() => import("../terminal/TerminalPane"));

type PaneLayout = "single" | "split" | "tiled";

const LAYOUT_OPTIONS = [
  { value: "single" as const, label: "Single" },
  { value: "split" as const, label: "Split" },
  { value: "tiled" as const, label: "Tiled" },
];

const LAYOUT_LIMIT: Record<PaneLayout, number> = { single: 1, split: 2, tiled: 4 };

/**
 * Terminal board: every open run is a live terminal pane. Panes stay mounted
 * when hidden so processes and scrollback survive layout and tab switches.
 */
export default function CodeView({
  sessions,
  fleet,
  openIds,
  activeId,
  theme,
  workspace,
  onSelect,
  onClose,
  onNewTerminal,
  onStaged,
  onChooseProject,
}: {
  sessions: Session[];
  fleet: FleetEntry[];
  openIds: string[];
  activeId: string | null;
  theme: "dark" | "light";
  workspace: Workspace | null;
  onSelect: (session: Session) => void;
  onClose: (session: Session) => void;
  onNewTerminal: () => void;
  onStaged: () => void;
  onChooseProject: () => void;
}) {
  const [layout, setLayout] = useState<PaneLayout>("single");
  const clashing = fleet.filter((entry) => entry.overlaps.length > 0).length;

  const open = openIds
    .map((id) => sessions.find((session) => session.id === id))
    .filter((session): session is Session => Boolean(session));

  const limit = LAYOUT_LIMIT[layout];
  const shown = layout === "single"
    ? open.filter((session) => session.id === activeId).slice(0, 1)
    : open.slice(0, limit);
  const shownIds = new Set(shown.map((session) => session.id));

  return (
    <>
      <div className="cg-view-toolbar">
        <h1>Terminals</h1>
        <button
          type="button"
          className="cg-project-btn"
          onClick={onChooseProject}
          title={workspace?.path ?? "Choose a project folder"}
        >
          <span className="cg-project-dot" aria-hidden="true" />
          <span className="cg-project-name">{workspace?.name ?? "Choose project"}</span>
          <span className="cg-project-change">Change</span>
        </button>
        <span className="cg-view-sub">{open.length} open</span>
        {clashing > 0 && (
          <Chip tone="warn">
            {clashing} run{clashing === 1 ? "" : "s"} overlap
          </Chip>
        )}
        <span className="cg-toolbar-spacer" />
        <MiniSeg value={layout} options={LAYOUT_OPTIONS} onChange={setLayout} label="Pane layout" />
        <button type="button" className="cg-btn" data-variant="primary" onClick={onNewTerminal}>
          <LuPlus aria-hidden="true" /> New terminal
        </button>
      </div>
      {open.length === 0 ? (
        <div className="cg-pane-empty">
          <strong>No terminals open</strong>
          <span>Pick a run in the rail, or open a plain shell terminal.</span>
        </div>
      ) : (
        <div className="cg-pane-canvas" data-layout={layout}>
          <Suspense fallback={null}>
            {open.map((session) => (
              <TerminalPane
                key={session.id}
                session={session}
                visible={shownIds.has(session.id)}
                theme={theme}
                onActivate={() => onSelect(session)}
                onClose={() => onClose(session)}
                onStaged={onStaged}
              />
            ))}
          </Suspense>
        </div>
      )}
    </>
  );
}
