import { LuPlus } from "react-icons/lu";

import type { FleetEntry, Session } from "@/lib/api";
import type { Workspace } from "../../../shared/workspace";
import { Chip, MiniSeg } from "../primitives";
import { LAYOUT_OPTIONS, openSessions, type PaneLayout } from "../terminal/PaneCanvas";

/**
 * Single mode's header: the runs rail drives the shared pane canvas that Shell
 * keeps mounted between Single and Team, so terminals survive a mode switch.
 */
export default function CodeView({
  sessions,
  backendAvailable = true,
  fleet,
  openIds,
  layout,
  onLayout,
  workspace,
  onNewTerminal,
  onChooseProject,
}: {
  sessions: Session[];
  backendAvailable?: boolean;
  fleet: FleetEntry[];
  openIds: string[];
  layout: PaneLayout;
  onLayout: (layout: PaneLayout) => void;
  workspace: Workspace | null;
  onNewTerminal: () => void;
  onChooseProject: () => void;
}) {
  const clashing = fleet.filter((entry) => entry.overlaps.length > 0).length;
  const open = openSessions(sessions, openIds);

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
        <MiniSeg value={layout} options={LAYOUT_OPTIONS} onChange={onLayout} label="Pane layout" />
        <button
          type="button"
          className="cg-btn"
          data-variant="primary"
          onClick={onNewTerminal}
          disabled={!workspace || !backendAvailable}
          title={workspace ? "Open a plain shell terminal" : "Choose a project folder first"}
        >
          <LuPlus aria-hidden="true" /> New terminal
        </button>
      </div>
      {open.length === 0 && (
        <div className="cg-pane-empty">
          <strong>No terminals open</strong>
          <span>Pick a run in the rail, or open a plain shell terminal.</span>
        </div>
      )}
    </>
  );
}
