import { useState, useSyncExternalStore } from "react";
import { projectRuntime, prepareProject } from "../../../shared/projectRuntime";
import { LuPlus } from "react-icons/lu";

import type { FleetEntry, Session } from "@/shared/api";
import type { Workspace } from "../../../shared/workspace";
import { Chip } from "../primitives";
import { openSessions } from "../terminal/PaneCanvas";
import DiagnosticsDialog from "../DiagnosticsDialog";
import AgentTabs from "../AgentTabs";

/**
 * Single mode's header: the runs rail drives the shared pane canvas that Shell
 * keeps mounted between Single and Team, so terminals survive a mode switch.
 */
export default function CodeView({
  sessions,
  backendAvailable = true,
  fleet,
  openIds,
  activeId,
  workspace,
  onNewTerminal,
  onSelect,
  onClose,
  onNewAgent,
  onChooseProject,
}: {
  sessions: Session[];
  backendAvailable?: boolean;
  fleet: FleetEntry[];
  openIds: string[];
  activeId: string | null;
  workspace: Workspace | null;
  onNewTerminal: () => void;
  onSelect: (session: Session) => void;
  onClose: (session: Session) => void;
  onNewAgent: () => void;
  onChooseProject: () => void;
}) {
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const project = useSyncExternalStore(projectRuntime.subscribe, projectRuntime.read);
  const clashing = fleet.filter((entry) => entry.overlaps.length > 0).length;
  const open = openSessions(sessions, openIds);

  return (
    <>
      {project.error && <p className="cg-banner" role="alert">{project.error} <button className="cg-btn" onClick={() => project.path && void prepareProject(project.path).catch(() => {})}>Retry project</button></p>}
      {project.path && !project.ready && !project.error && <p className="cg-empty-note" role="status">Loading project...</p>}
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
        <button type="button" className="cg-btn cg-btn-sm" onClick={() => setDiagnosticsOpen(true)}>
          Diagnostics
        </button>
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
      <AgentTabs
        sessions={sessions}
        openIds={openIds}
        activeId={activeId}
        onSelect={onSelect}
        onClose={onClose}
        onNewAgent={onNewAgent}
      />
      {diagnosticsOpen && <DiagnosticsDialog backendAvailable={backendAvailable} onClose={() => setDiagnosticsOpen(false)} />}
      {open.length === 0 && (
        <div className="cg-pane-empty">
          <strong>No terminals open</strong>
          <span>Open an agent tab or start a new terminal for this project.</span>
        </div>
      )}
    </>
  );
}
