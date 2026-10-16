import { LuPlus, LuX } from "react-icons/lu";

import type { ContextWindowReading, Session } from "../../shared/api";
import { agentLabel, agentMonogram } from "./agents";
import { AgentMark, StatusIcon } from "./primitives";

type AgentTabsProps = {
  sessions: Session[];
  openIds: string[];
  activeId: string | null;
  onSelect: (session: Session) => void;
  onClose: (session: Session) => void;
  onNewAgent: () => void;
  contextWindows?: Record<string, ContextWindowReading>;
};

function ContextBadge({ reading }: { reading?: ContextWindowReading }) {
  if (!reading) return null;
  if (reading.percentage === null) return <span className="cg-context-badge" title="Context limit unknown">—</span>;
  const tone = reading.percentage >= 90 ? "bad" : reading.percentage >= 70 ? "warn" : "";
  return <span className="cg-context-badge" data-tone={tone} title={`${reading.used_tokens.toLocaleString()} / ${reading.limit_tokens?.toLocaleString()} tokens`}>{Math.round(reading.percentage)}%</span>;
}

/** Agent tabs remain available after their terminal process is stopped. */
export default function AgentTabs({ sessions, openIds, activeId, onSelect, onClose, onNewAgent, contextWindows = {} }: AgentTabsProps) {
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
            <ContextBadge reading={contextWindows[session.id]} />
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
