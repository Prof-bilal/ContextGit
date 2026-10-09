import { useCallback, useState } from "react";
import { NAMED_AGENTS, type NamedAgent } from "../../mock/fixtures";
import AgentDialog from "../agent/AgentDialog";
import { DEFAULT_DRAFT, draftFrom, humanSchedule, newSeed, type MissionDraft } from "../agent/mission";
import { Chip, Field } from "../primitives";
import RosterRail from "../rail/RosterRail";
import AgentView from "../views/AgentView";
import UsageFeature from "./UsageFeature";
import { useWorkbench } from "../WorkbenchContext";
import { FeaturePorts } from "../FeaturePorts";


export default function AgentFeature() {
  const { tab, overlayOpen } = useWorkbench();
  const [agentId, setAgentId] = useState(NAMED_AGENTS[0]?.id ?? "");

  const [agents, setAgents] = useState<NamedAgent[]>(NAMED_AGENTS);

  const [agentDialog, setAgentDialog] = useState<{ mode: "create" | "edit"; draft: MissionDraft } | null>(
    null,
  );
  const [surface, setSurface] = useState<"agents" | "usage">("agents");

  const activeAgent = agents.find((agent) => agent.id === agentId) ?? agents[0];

  const saveAgent = useCallback(
    (draft: MissionDraft) => {
      const routine = {
        enabled: draft.enabled,
        cron: draft.cron,
        human: humanSchedule(draft.cron),
        nextRuns: [],
      };
      if (agentDialog?.mode === "edit") {
        setAgents((current) =>
          current.map((entry) =>
            entry.id === activeAgent.id
              ? {
                ...entry,
                name: draft.name.trim() || entry.name,
                brief: draft.mission.trim(),
                skills: draft.skills,
                hue: draft.hue,
                seed: draft.seed,
                monogram: draft.name.trim().charAt(0).toUpperCase() || entry.monogram,
                routine: { ...entry.routine, ...routine },
              }
              : entry,
          ),
        );
        return;
      }
      const slug =
        draft.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 24) || "new";
      const created: NamedAgent = {
        id: `agent_${slug}_${Math.random().toString(36).slice(2, 6)}`,
        name: draft.name.trim(),
        monogram: draft.name.trim().charAt(0).toUpperCase(),
        hue: draft.hue,
        seed: draft.seed,
        brief: draft.mission.trim(),
        memory: { decisions: [], facts: [], deadEnds: [], openQuestions: [] },
        skills: draft.skills,
        routine,
        runs: [],
      };
      setAgents((current) => [...current, created]);
      setAgentId(created.id);
    },
    [agentDialog?.mode, activeAgent.id],
  );

  if (surface === "usage") {
    return <UsageFeature onClose={() => setSurface("agents")} />;
  }

  const rail = () => {
    return (
      <RosterRail
        agents={agents}
        selectedId={agentId}
        onSelect={(agent) => setAgentId(agent.id)}
        onNewAgent={() =>
          setAgentDialog({ mode: "create", draft: { ...DEFAULT_DRAFT, seed: newSeed("") } })
        }
      />
    );
  };

  const view = () => {
    return (
      <AgentView
        agent={activeAgent}
        onUpdate={(patch) =>
          setAgents((current) =>
            current.map((entry) => (entry.id === activeAgent.id ? { ...entry, ...patch } : entry)),
          )
        }
        onEditMission={() =>
          setAgentDialog({ mode: "edit", draft: draftFrom(activeAgent) })
        }
      />
    );
  };

  const dock = () => {
    return (
      <>
        <div className="cg-fields">
          <Field label="Agent">{activeAgent.name}</Field>
          <Field label="Routine">
            <span className="cg-routine-code">{activeAgent.routine.cron}</span>
          </Field>
          <Field label="Schedule">{activeAgent.routine.human}</Field>
          <Field label="Skills">{activeAgent.skills.length}</Field>
          <Field label="Runs">{activeAgent.runs.length}</Field>
        </div>
        <div className="cg-dock-actions">
          <button
            type="button"
            className="cg-btn"
            data-variant="primary"
            aria-haspopup="dialog"
            onClick={() => setAgentDialog({ mode: "edit", draft: draftFrom(activeAgent) })}
          >
            Edit brief
          </button>
          <button type="button" className="cg-btn" onClick={() => setSurface("usage")}>
            Usage
          </button>
        </div>
      </>
    );
  };

  const footer = () => {
    return (
      <footer className="cg-bottombar">
        <span className="cg-bb-info">
          <strong>{activeAgent.name}</strong>
          <Chip tone={activeAgent.routine.enabled ? "ok" : "warn"}>
            {activeAgent.routine.enabled ? "routine on" : "paused"}
          </Chip>
          <span className="cg-view-sub">{activeAgent.routine.human}</span>
        </span>
      </footer>
    );
  };

  const dialogs = () => <>{agentDialog && (
    <AgentDialog
      mode={agentDialog.mode}
      initial={agentDialog.draft}
      onSave={saveAgent}
      onClose={() => setAgentDialog(null)}
    />
  )}</>;
  return <FeaturePorts id="issues"
    title={"Agent"}
    rail={rail}
    view={view}
    dock={dock}
    footer={footer}
    dialogs={dialogs}
    onDismissDialogs={() => { setAgentDialog(null); }}
    hasModal={agentDialog !== null} />;
}
