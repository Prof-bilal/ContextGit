import { LuPlus, LuX } from "react-icons/lu";

import type { Session } from "../../shared/api";
import { agentLabel, agentMonogram } from "./agents";
import { AgentMark, StatusIcon } from "./primitives";

type AgentTabsProps = {
  sessions: Session[];
  openIds: string[];
  activeId: string | null;
  onSelect: (session: Session) => void;
  onClose: (session: Session) => void;
  onNewAgent: () => void;
};

/** Agent tabs remain available after their terminal process is stopped. */
export default function AgentTabs({ sessions, openIds, activeId, onSelect, onClose, onNewAgent }: AgentTabsProps) {
  return (
    <div className="cg-agent-tabs" role="tablist" aria-label="Open agents">
      {sessions.map((session) => (
        <div key={session.id} className="cg-agent-tab-wrap">
          <button
            type="button"
            role="tab"
            aria-selected={session.id === activeId}
            className="cg-agent-tab"
            data-active={session.id === activeId}
            onClick={() => onSelect(session)}
            title={`${session.name} · ${agentLabel(session.agent)} · ${openIds.includes(session.id) && session.status === "running" ? "Running" : "Offline"}`}
          >
            <AgentMark agent={session.agent ?? "shell"} label={agentMonogram(session.agent)} />
            <span className="cg-agent-tab-name">{session.name}</span>
            <StatusIcon status={openIds.includes(session.id) ? session.status : "idle"} />
            {(!openIds.includes(session.id) || session.status !== "running") && <span className="cg-agent-tab-offline">Offline</span>}
          </button>
          <button
            type="button"
            className="cg-agent-tab-close"
            aria-label={`Close ${session.name} tab`}
            title="Close agent tab"
            onClick={(event) => {
              event.stopPropagation();
              onClose(session);
            }}
          >
            <LuX aria-hidden="true" />
          </button>
        </div>
      ))}
      <button type="button" className="cg-agent-tab-add" onClick={onNewAgent}>
        <LuPlus aria-hidden="true" />
        <span>New agent</span>
      </button>
    </div>
  );
}
