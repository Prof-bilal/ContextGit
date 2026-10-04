import type { Session, Task, TaskStatus } from "@/lib/api";

import { agentMonogram } from "../agents";
import { AgentMark, Chip, StatusIcon } from "../primitives";

const COLUMNS: ReadonlyArray<{ status: TaskStatus; label: string }> = [
  { status: "todo", label: "To do" },
  { status: "blocked", label: "Blocked" },
  { status: "working", label: "Working" },
  { status: "review", label: "Review" },
  { status: "done", label: "Done" },
  { status: "failed", label: "Failed" },
];

/** The task graph as columns; a card is one task, with its owner and its scope. */
export default function TeamBoard({
  tasks,
  sessions,
  titles,
  selectedId,
  onSelect,
}: {
  tasks: Task[];
  /** Live runs, so a card can show its session's status dot. */
  sessions: Session[];
  /** Task id → title, for naming dependencies. */
  titles: Record<string, string>;
  selectedId: string | null;
  onSelect: (task: Task) => void;
}) {
  const bySession = new Map(sessions.map((session) => [session.id, session]));

  return (
    <div className="cg-board">
      {COLUMNS.map((column) => {
        const items = tasks.filter((task) => task.status === column.status);
        return (
          <section key={column.status} className="cg-board-col" data-status={column.status}>
            <header className="cg-board-head">
              <span>{column.label}</span>
              <span className="cg-count">{items.length}</span>
            </header>
            {items.map((task) => {
              const session = task.session_id ? bySession.get(task.session_id) : undefined;
              return (
                <button
                  key={task.id}
                  type="button"
                  className="cg-board-card"
                  aria-current={task.id === selectedId}
                  onClick={() => onSelect(task)}
                >
                  <span className="cg-board-card-top">
                    {session && <StatusIcon status={session.status} />}
                    <span className="cg-board-title">{task.title}</span>
                  </span>
                  <span className="cg-board-card-meta">
                    <AgentMark agent={task.agent ?? "shell"} label={agentMonogram(task.agent)} />
                    <span className="cg-board-role">{task.role}</span>
                  </span>
                  {task.scope.length > 0 && (
                    <span className="cg-board-scope">
                      {task.scope.map((glob) => (
                        <Chip key={glob}>{glob}</Chip>
                      ))}
                    </span>
                  )}
                  {task.blocked_by.length > 0 && (
                    <span className="cg-board-blocked">
                      waiting on {task.blocked_by.map((id) => titles[id] ?? id).join(", ")}
                    </span>
                  )}
                  {(task.gate_status || task.status === "review") && (
                    <span className="cg-board-card-meta">
                      {task.gate_status ? (
                        <Chip tone={task.gate_status === "pass" ? "ok" : "bad"}>
                          gate {task.gate_status}
                        </Chip>
                      ) : (
                        <Chip tone="warn">awaiting review</Chip>
                      )}
                      {task.verifier_session_id && <Chip>verifier</Chip>}
                    </span>
                  )}
                </button>
              );
            })}
            {items.length === 0 && <p className="cg-empty-note">—</p>}
          </section>
        );
      })}
    </div>
  );
}
