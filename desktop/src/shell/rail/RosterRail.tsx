import type { NamedAgent } from "../../mock/fixtures";
import ClayAvatar from "../avatar/ClayAvatar";
import { avatarState } from "../avatar/traits";
import { agentSeed, humanSchedule } from "../agent/mission";
import { Chip } from "../primitives";

/** The agent roster — five shipped presets plus whatever the user creates. */
export default function RosterRail({
  agents,
  selectedId,
  onSelect,
  onNewAgent,
}: {
  agents: NamedAgent[];
  selectedId: string;
  onSelect: (agent: NamedAgent) => void;
  onNewAgent: () => void;
}) {
  return (
    <nav className="cg-rail" aria-label="Named agents">
      <div className="cg-rail-head">
        <h2>Agents</h2>
        <span className="cg-count">{agents.length}</span>
      </div>
      <button type="button" className="cg-new-btn" onClick={onNewAgent}>
        ＋ New agent
      </button>
      {agents.map((agent) => (
        <button
          key={agent.id}
          type="button"
          className="cg-row"
          aria-current={agent.id === selectedId}
          onClick={() => onSelect(agent)}
        >
          <ClayAvatar
            seed={agentSeed(agent)}
            hue={agent.hue}
            state={avatarState(agent)}
            size="sm"
          />
          <span className="cg-row-copy">
            <span className="cg-row-title">{agent.name}</span>
            <span className="cg-row-meta">
              {agent.routine.enabled ? (
                <Chip tone="ok">next {agent.routine.nextRuns[0] ?? humanSchedule(agent.routine.cron)}</Chip>
              ) : (
                <Chip tone="warn">paused</Chip>
              )}
            </span>
          </span>
        </button>
      ))}
      {agents.length === 0 && (
        <p className="cg-empty-note cg-rail-search">No agents yet. Create one — it gets its own creature.</p>
      )}
    </nav>
  );
}
