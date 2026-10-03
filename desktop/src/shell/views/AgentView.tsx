import { useEffect, useRef, useState } from "react";

import type { AgentRun, NamedAgent } from "../../mock/fixtures";
import ClayAvatar from "../avatar/ClayAvatar";
import { AVATAR_STATE_LABEL, type AvatarState } from "../avatar/traits";
import { agentSeed, humanSchedule } from "../agent/mission";
import RunOutput from "../agent/RunOutput";
import { RunDiffSheet, RunSheet } from "../agent/RunSheets";
import { Chip, StatusIcon } from "../primitives";

const MEMORY_SECTIONS = [
  { key: "decisions", label: "Decisions" },
  { key: "facts", label: "Facts" },
  { key: "deadEnds", label: "Dead ends" },
  { key: "openQuestions", label: "Open questions" },
] as const;

function relative(date: string): string {
  const minutes = Math.floor((Date.now() - new Date(date).getTime()) / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Agent detail — controlled. The agent's mission, skills, routine and state all
 * live in the roster (Shell), so edits survive switching agents. Only the run
 * simulation is local: Run now makes the creature react (working → done).
 */
export default function AgentView({
  agent,
  onUpdate,
  onEditMission,
}: {
  agent: NamedAgent;
  onUpdate: (patch: Partial<NamedAgent>) => void;
  onEditMission: () => void;
}) {
  const [last, setLast] = useState<AgentRun["status"] | "idle">(agent.runs[0]?.status ?? "idle");
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ run: AgentRun; view: "diff" | "run" } | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    setLast(agent.runs[0]?.status ?? "idle");
    setOpenRun(null);
    setSheet(null);
  }, [agent.id, agent.runs]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const enabled = agent.routine.enabled;
  const state: AvatarState = !enabled
    ? "paused"
    : last === "running"
      ? "working"
      : last === "error"
        ? "error"
        : last === "done"
          ? "done"
          : "idle";

  const runNow = () => {
    setLast("running");
    timers.current.push(window.setTimeout(() => setLast("done"), 2400));
  };

  return (
    <div className="cg-view-body">
      <div className="cg-doc">
        <header className="cg-doc-head">
          <ClayAvatar
            seed={agentSeed(agent)}
            hue={agent.hue}
            state={state}
            size="lg"
            label={`${agent.name} avatar — ${AVATAR_STATE_LABEL[state]}`}
          />
          <div className="cg-doc-title">
            <h1>{agent.name}</h1>
            <p>{agent.brief}</p>
            <div className="cg-tags">
              <Chip tone={enabled ? "ok" : "warn"}>{enabled ? "routine on" : "paused"}</Chip>
              <Chip tone="warn">sample data</Chip>
              <button
                type="button"
                className="cg-btn cg-btn-sm"
                onClick={onEditMission}
                aria-haspopup="dialog"
              >
                Edit agent
              </button>
            </div>
          </div>
        </header>

        <section className="cg-section">
          <h2>Memory</h2>
          <div className="cg-cards">
            {MEMORY_SECTIONS.map((section) => {
              const items = agent.memory[section.key];
              return (
                <div key={section.key} className="cg-card" data-kind={section.key}>
                  <h3>
                    {section.label} <span className="cg-chip">{items.length}</span>
                  </h3>
                  {items.length > 0 ? (
                    <ul>
                      {items.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="cg-card-empty">Nothing recorded yet.</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="cg-section">
          <h2>Skills</h2>
          <div className="cg-tags">
            {agent.skills.map((skill) => (
              <Chip key={skill}>{skill}</Chip>
            ))}
            {agent.skills.length === 0 && <p className="cg-card-empty">No skills selected.</p>}
          </div>
        </section>

        <section className="cg-section">
          <h2>Routine</h2>
          <div className="cg-routine">
            <div className="cg-routine-row">
              <span className="cg-routine-code">{agent.routine.cron}</span>
              <span className="cg-view-sub">{humanSchedule(agent.routine.cron)}</span>
              <span className="cg-toolbar-spacer" />
              <label className="cg-toggle">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) =>
                    onUpdate({ routine: { ...agent.routine, enabled: event.target.checked } })
                  }
                />
                Enabled
              </label>
              <button
                type="button"
                className="cg-btn cg-btn-sm"
                data-variant="primary"
                onClick={runNow}
                disabled={!enabled || state === "working"}
              >
                {state === "working" ? "Running…" : "Run now"}
              </button>
            </div>
            {enabled && agent.routine.nextRuns.length > 0 ? (
              <div className="cg-routine-next">
                {agent.routine.nextRuns.map((run) => (
                  <Chip key={run} tone="ok">
                    next: {run}
                  </Chip>
                ))}
              </div>
            ) : (
              <p className="cg-empty-note">
                {enabled
                  ? `Next runs follow ${humanSchedule(agent.routine.cron)}.`
                  : "Paused — no runs will fire."}
              </p>
            )}
          </div>
        </section>

        <section className="cg-section">
          <h2>Recent runs</h2>
          <div className="cg-runs">
            {state === "working" && (
              <div className="cg-run" data-live="true">
                <StatusIcon status="running" />
                <span className="cg-run-copy">
                  <strong>Running now…</strong>
                  <span>started just now · this agent is working</span>
                </span>
              </div>
            )}
            {agent.runs.map((run) => (
              <div key={run.id} className="cg-run-wrap">
                <button
                  type="button"
                  className="cg-run cg-run-btn"
                  aria-expanded={openRun === run.id}
                  onClick={() => setOpenRun((current) => (current === run.id ? null : run.id))}
                >
                  <StatusIcon status={run.status} />
                  <span className="cg-run-copy">
                    <strong>{run.summary}</strong>
                    <span>
                      {relative(run.startedAt)} · {run.durationMin}m ·{" "}
                      {(run.tokens / 1000).toFixed(1)}k tok
                      {run.branches.length > 0 ? ` · ${run.branches.join(", ")}` : ""}
                    </span>
                  </span>
                  <span className="cg-run-caret" aria-hidden="true">
                    ⌄
                  </span>
                </button>
                {openRun === run.id && (
                  <RunOutput
                    run={run}
                    onViewDiff={() => setSheet({ run, view: "diff" })}
                    onOpenRun={() => setSheet({ run, view: "run" })}
                  />
                )}
              </div>
            ))}
            {agent.runs.length === 0 && (
              <p className="cg-card-empty">
                This agent has not run yet — hit “Run now” to see it work.
              </p>
            )}
          </div>
        </section>
      </div>

      {sheet?.view === "diff" && (
        <RunDiffSheet run={sheet.run} agent={agent} onClose={() => setSheet(null)} />
      )}
      {sheet?.view === "run" && (
        <RunSheet run={sheet.run} agent={agent} onClose={() => setSheet(null)} />
      )}
    </div>
  );
}
