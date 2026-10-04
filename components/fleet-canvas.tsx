import { FLEET, type FleetStatus } from "@/lib/landing";

const STATUS_LABEL: Record<FleetStatus, string> = {
  running: "working",
  blocked: "blocked",
  merged: "merged into main",
  idle: "idle",
};

/** The hero proof object: several agents, each a worktree and branch, feeding
 *  a merge queue into main. One run is blocked on a file it shares with another. */
export default function FleetCanvas() {
  return (
    <div
      className="fleet"
      role="img"
      aria-label="Five agent runs, each in its own git worktree and branch, feeding a merge queue into main. One run is blocked on a file it shares with another run."
    >
      <div className="fleet-bar">
        <span className="mono">contextgit fleet</span>
        <span className="mono fleet-target">&rarr; main</span>
      </div>

      <ol className="fleet-list">
        {FLEET.map((run) => (
          <li key={run.branch} className="fleet-row" data-status={run.status}>
            <span className="fleet-mark" data-agent={run.key} aria-hidden="true">
              {run.mark}
            </span>
            <span className="fleet-role">{run.role}</span>
            <span className="fleet-branch mono">{run.branch}</span>
            <span className="fleet-files mono">{run.files} files</span>
            <span className="fleet-ahead mono">{run.ahead > 0 ? `+${run.ahead}` : "—"}</span>
            <span className="fleet-status">
              <span className="fleet-dot" aria-hidden="true" />
              {STATUS_LABEL[run.status]}
            </span>
            {run.note && <span className="fleet-note">{run.note}</span>}
          </li>
        ))}
      </ol>

      <div className="fleet-queue">
        <span className="mono fleet-queue-label">merge queue</span>
        <span className="fleet-chip" data-state="done">ctx/api-contract</span>
        <span className="fleet-chip" data-state="next">ctx/frontend</span>
        <span className="fleet-chip" data-state="blocked">ctx/tests</span>
        <span className="fleet-chip" data-state="queued">ctx/docs</span>
      </div>
    </div>
  );
}
