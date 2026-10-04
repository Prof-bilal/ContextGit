import { LuPlus } from "react-icons/lu";

import type { Session, SessionStatus, Task, TaskStatus } from "@/lib/api";

import { agentMonogram } from "../agents";
import { AgentMark, Chip, StatusIcon } from "../primitives";

/** Board order: what needs attention first. */
const ORDER: TaskStatus[] = ["working", "todo", "blocked", "review", "done", "failed"];

/** The dot a task shows before its run has a session of its own. */
const DOT: Record<TaskStatus, SessionStatus> = {
  todo: "idle",
  blocked: "idle",
  working: "running",
  review: "idle",
  done: "done",
  failed: "error",
};

/** The team rail: the task list, grouped so blocked work is visible at a glance. */
export default function TeamRail({
  tasks,
  sessions,
  selectedId,
  onSelect,
  onNew,
}: {
  tasks: Task[];
  sessions: Session[];
  selectedId: string | null;
  onSelect: (task: Task) => void;
  onNew: () => void;
}) {
  const bySession = new Map(sessions.map((session) => [session.id, session]));
  const ordered = [...tasks].sort(
    (a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.position - b.position,
  );

  return (
    <nav className="cg-rail" aria-label="Team tasks">
      <div className="cg-rail-head">
        <h2>Tasks</h2>
        <span className="cg-count">{tasks.length}</span>
      </div>
      <button type="button" className="cg-new-btn" onClick={onNew}>
        <LuPlus aria-hidden="true" /> New task
      </button>
      {ordered.map((task) => {
        const session = task.session_id ? bySession.get(task.session_id) : undefined;
        return (
          <button
            key={task.id}
            type="button"
            className="cg-row cg-row-flat"
            aria-current={task.id === selectedId}
            title={`${task.role}${task.scope.length > 0 ? ` · ${task.scope.join(", ")}` : ""}`}
            onClick={() => onSelect(task)}
          >
            <StatusIcon status={session?.status ?? DOT[task.status]} />
            <span className="cg-row-title">{task.title}</span>
            <span className="cg-toolbar-spacer" />
            {task.blocked_by.length > 0 && <Chip tone="warn">blocked</Chip>}
            {task.status === "review" && <Chip tone="signal">review</Chip>}
            <AgentMark agent={task.agent ?? "shell"} label={agentMonogram(task.agent)} />
          </button>
        );
      })}
      {tasks.length === 0 && (
        <p className="cg-empty-note cg-rail-search">
          No tasks yet. Add one per run, then launch the team.
        </p>
      )}
    </nav>
  );
}
