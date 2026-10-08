import { useState } from "react";
import { LuPlus } from "react-icons/lu";

import type { Session, Task } from "@/lib/api";

import { Chip } from "../primitives";
import TeamBoard from "../team/TeamBoard";

/**
 * Team mode: the task graph as a board over the same runs Single mode uses.
 * The terminals live in the shared pane canvas Shell keeps mounted, so
 * switching modes never restarts an agent.
 */
export default function TeamView({
  tasks,
  sessions,
  selectedId,
  teamName,
  busy,
  workspaceName,
  onSelectTask,
  onNewTask,
  onLaunch,
  onMerge,
  onCreateTeam,
  onChooseProject,
}: {
  tasks: Task[];
  sessions: Session[];
  selectedId: string | null;
  teamName: string | null;
  busy: boolean;
  workspaceName: string | null;
  onSelectTask: (task: Task) => void;
  onNewTask: () => void;
  onLaunch: () => void;
  onMerge: () => void;
  onCreateTeam: (name: string) => void;
  onChooseProject: () => void;
}) {
  const [teamNameInput, setTeamNameInput] = useState("");
  const titles = Object.fromEntries(tasks.map((task) => [task.id, task.title]));
  const blocked = tasks.filter((task) => task.status === "blocked").length;
  const review = tasks.filter((task) => task.status === "review").length;
  const done = tasks.filter((task) => task.status === "done").length;

  return (
    <>
      <div className="cg-view-toolbar">
        <h1>Team</h1>
        {teamName && <Chip>{teamName}</Chip>}
        <button
          type="button"
          className="cg-project-btn"
          onClick={onChooseProject}
          title="Choose the project folder the team works in"
        >
          <span className="cg-project-dot" aria-hidden="true" />
          <span className="cg-project-name">{workspaceName ?? "Choose project"}</span>
          <span className="cg-project-change">Change</span>
        </button>
        <span className="cg-view-sub">
          {tasks.length} task{tasks.length === 1 ? "" : "s"}
          {blocked > 0 ? ` · ${blocked} blocked` : ""}
          {review > 0 ? ` · ${review} in review` : ""}
          {done > 0 ? ` · ${done} done` : ""}
        </span>
        <span className="cg-toolbar-spacer" />
        <button type="button" className="cg-btn" onClick={onNewTask} disabled={!workspaceName}>
          <LuPlus aria-hidden="true" /> New task
        </button>
        <button
          type="button"
          className="cg-btn"
          data-variant="primary"
          onClick={onLaunch}
          disabled={busy || tasks.length === 0}
        >
          {busy ? "Launching…" : "Launch team"}
        </button>
        <button type="button" className="cg-btn" onClick={onMerge} disabled={busy || done === 0}>
          Merge done
        </button>
      </div>

      <div className="cg-view-body">
        {teamName === null ? (
          <div className="cg-doc">
            <h2>Start a team</h2>
            <p className="cg-empty-note">
              A team is a mission over this project: one task per run, each with its own role,
              agent and file scope. Runs that claim the same files are refused.
            </p>
            <form
              className="cg-inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                const name = teamNameInput.trim();
                if (name && workspaceName) onCreateTeam(name);
              }}
            >
              <input
                className="cg-text-input"
                value={teamNameInput}
                onChange={(event) => setTeamNameInput(event.target.value)}
                placeholder="e.g. portal v2"
                aria-label="Team name"
              />
              <button
                type="button"
                className="cg-btn"
                data-variant="primary"
                disabled={!teamNameInput.trim() || !workspaceName || busy}
                onClick={() => onCreateTeam(teamNameInput.trim())}
              >
                {busy ? "Creating…" : "Create team"}
              </button>
            </form>
            {!workspaceName && (
              <p className="cg-empty-note">Choose a project folder first.</p>
            )}
          </div>
        ) : tasks.length === 0 ? (
          <div className="cg-doc">
            <p className="cg-empty-note">
              No tasks yet. Add a task per run — give each one a role, an agent and the
              files it owns — then launch the team.
            </p>
          </div>
        ) : (
          <TeamBoard
            tasks={tasks}
            sessions={sessions}
            titles={titles}
            selectedId={selectedId}
            onSelect={onSelectTask}
          />
        )}
      </div>
    </>
  );
}
