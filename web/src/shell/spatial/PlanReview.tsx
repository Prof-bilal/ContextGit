import { LuX } from "react-icons/lu";
import { HARNESSES } from "@/shared/harnesses";
import type { TeamPlanTask } from "@/shared/api";

export default function PlanReview({
  name,
  tasks,
  setTasks,
  approve,
  close,
  busy,
}: {
  name: string;
  tasks: TeamPlanTask[];
  setTasks: (tasks: TeamPlanTask[]) => void;
  approve: () => void;
  close: () => void;
  busy: boolean;
}) {
  const edit = (index: number, patch: Partial<TeamPlanTask>) =>
    setTasks(
      tasks.map((task, i) => (i === index ? { ...task, ...patch } : task)),
    );
  return (
    <aside
      className="sp-float sp-plan"
      role="dialog"
      aria-label="Review team plan"
    >
      <header>
        <div>
          <small>Review before launch</small>
          <h2>{name} plan</h2>
        </div>
        <button onClick={close} aria-label="Close plan">
          <LuX />
        </button>
      </header>
      {tasks.map((task, index) => (
        <fieldset className="sp-plan-worker" key={task.id ?? index}>
          <legend>{task.id ?? `worker-${index + 1}`}</legend>
          <label>
            Task
            <input
              value={task.title}
              onChange={(event) => edit(index, { title: event.target.value })}
            />
          </label>
          <label>
            CLI
            <select
              value={task.agent ?? "claude"}
              onChange={(event) => edit(index, { agent: event.target.value })}
            >
              {HARNESSES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Role
            <input
              value={task.role ?? ""}
              onChange={(event) => edit(index, { role: event.target.value })}
            />
          </label>
          <label>
            Instructions
            <textarea
              value={task.brief ?? ""}
              onChange={(event) => edit(index, { brief: event.target.value })}
            />
          </label>
          <label>
            File ownership (comma separated)
            <input
              value={task.scope?.join(", ") ?? ""}
              onChange={(event) =>
                edit(index, {
                  scope: event.target.value
                    .split(",")
                    .map((value) => value.trim()),
                })
              }
            />
          </label>
          <label>
            Dependencies (worker IDs)
            <input
              value={task.depends_on?.join(", ") ?? ""}
              onChange={(event) =>
                edit(index, {
                  depends_on: event.target.value
                    .split(",")
                    .map((value) => value.trim()),
                })
              }
            />
          </label>
          <label>
            Completion criteria
            <textarea
              value={task.done_criteria ?? ""}
              onChange={(event) =>
                edit(index, { done_criteria: event.target.value })
              }
            />
          </label>
          <label>
            Quality gate (empty uses project default)
            <input
              value={task.gate_command ?? ""}
              onChange={(event) =>
                edit(index, { gate_command: event.target.value || null })
              }
            />
          </label>
          <label>
            Skill IDs
            <input
              value={task.skills?.join(", ") ?? ""}
              onChange={(event) =>
                edit(index, {
                  skills: event.target.value
                    .split(",")
                    .map((value) => value.trim()),
                })
              }
            />
          </label>
          <button onClick={() => setTasks(tasks.filter((_, i) => i !== index))}>
            Remove worker
          </button>
        </fieldset>
      ))}
      <button
        disabled={tasks.length >= 12}
        onClick={() =>
          setTasks([
            ...tasks,
            {
              id: `worker-${crypto.randomUUID().slice(0, 8)}`,
              title: "New worker",
              agent: "claude",
              role: "implementer",
              scope: [],
              depends_on: [],
            },
          ])
        }
      >
        Add worker ({tasks.length}/12)
      </button>
      <button
        className="sp-primary"
        disabled={busy || !tasks.length}
        onClick={approve}
      >
        {busy ? "Launching…" : "Approve and launch"}
      </button>
    </aside>
  );
}
