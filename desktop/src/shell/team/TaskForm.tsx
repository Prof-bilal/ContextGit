import { useState } from "react";

import { api, type Task, type TaskInput } from "@/lib/api";

import { AGENTS, DEFAULT_AGENT } from "../agents";
import Modal from "../Modal";

/** "src/api/**, docs/**" -> ["src/api/**", "docs/**"]. */
function parseList(text: string): string[] {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Create or edit one task: title, role, agent, scope, contract, dependencies. */
export default function TaskForm({
  task,
  tasks,
  onSaved,
  onClose,
}: {
  /** The task being edited, or null when creating. */
  task: Task | null;
  /** Every task in the team, for the dependency picker. */
  tasks: Task[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [brief, setBrief] = useState(task?.brief ?? "");
  const [doneCriteria, setDoneCriteria] = useState(task?.done_criteria ?? "");
  const [role, setRole] = useState(task?.role ?? "implementer");
  const [agent, setAgent] = useState(task?.agent ?? DEFAULT_AGENT);
  const [scope, setScope] = useState((task?.scope ?? []).join(", "));
  const [contract, setContract] = useState(task?.contract ?? "");
  const [gate, setGate] = useState(task?.gate_command ?? "");
  const [deps, setDeps] = useState<string[]>(task?.depends_on ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const others = tasks.filter((entry) => entry.id !== task?.id);

  const toggleDep = (id: string) =>
    setDeps((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );

  const save = async () => {
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const input: TaskInput = {
      title: trimmed,
      brief,
      done_criteria: doneCriteria,
      role: role.trim() || "implementer",
      agent,
      scope: parseList(scope),
      contract: contract.trim() || null,
      depends_on: deps,
      gate_command: gate.trim() || null,
    };
    try {
      if (task) await api.updateTask(task.id, input);
      else await api.createTask(input);
      onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the task");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={task ? "Edit task" : "New task"}
      subtitle="One owner, one file scope"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="cg-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="cg-btn"
            data-variant="primary"
            disabled={!title.trim() || busy}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : task ? "Save task" : "Add task"}
          </button>
        </>
      }
    >
      <label className="cg-kicker" htmlFor="cg-task-title">
        Title
      </label>
      <input
        id="cg-task-title"
        className="cg-text-input"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="e.g. api-contract"
      />

      <label className="cg-kicker" htmlFor="cg-task-brief">
        Brief
      </label>
      <textarea
        id="cg-task-brief"
        className="cg-text-input"
        rows={3}
        value={brief}
        onChange={(event) => setBrief(event.target.value)}
        placeholder="What this run should build, and any constraint that matters."
      />

      <label className="cg-kicker" htmlFor="cg-task-done">
        Done when
      </label>
      <input
        id="cg-task-done"
        className="cg-text-input"
        value={doneCriteria}
        onChange={(event) => setDoneCriteria(event.target.value)}
        placeholder="e.g. the endpoint returns 403 for cancelled tiers"
      />

      <div className="cg-form-row">
        <span>
          <label className="cg-kicker" htmlFor="cg-task-role">
            Role
          </label>
          <input
            id="cg-task-role"
            className="cg-text-input"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            placeholder="backend · frontend · qa"
          />
        </span>
        <span>
          <label className="cg-kicker" htmlFor="cg-task-agent">
            Agent
          </label>
          <select
            id="cg-task-agent"
            className="cg-text-input"
            value={agent}
            onChange={(event) => setAgent(event.target.value)}
          >
            {AGENTS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </span>
      </div>

      <label className="cg-kicker" htmlFor="cg-task-scope">
        Own files (optional)
      </label>
      <input
        id="cg-task-scope"
        className="cg-text-input"
        value={scope}
        onChange={(event) => setScope(event.target.value)}
        placeholder="e.g. src/api/**, openapi.yaml"
      />

      <label className="cg-kicker" htmlFor="cg-task-contract">
        Contract file (single owner, optional)
      </label>
      <input
        id="cg-task-contract"
        className="cg-text-input"
        value={contract}
        onChange={(event) => setContract(event.target.value)}
        placeholder="e.g. openapi.yaml"
      />

      <label className="cg-kicker" htmlFor="cg-task-gate">
        Gate command (optional)
      </label>
      <input
        id="cg-task-gate"
        className="cg-text-input"
        value={gate}
        onChange={(event) => setGate(event.target.value)}
        placeholder="e.g. npm test — defaults to the team's"
      />

      {others.length > 0 && (
        <>
          <span className="cg-kicker">Depends on</span>
          <div className="cg-tags" role="group" aria-label="Depends on">
            {others.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="cg-chip"
                aria-pressed={deps.includes(entry.id)}
                data-tone={deps.includes(entry.id) ? "signal" : undefined}
                onClick={() => toggleDep(entry.id)}
              >
                {entry.title}
              </button>
            ))}
          </div>
        </>
      )}

      <p className="cg-empty-note">
        Each task gets its own branch, worktree and terminal. Files two tasks claim are
        refused, so pick a scope one run can own.
      </p>
      {error && <p className="cg-pane-error">{error}</p>}
    </Modal>
  );
}
