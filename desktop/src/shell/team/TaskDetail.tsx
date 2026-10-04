import { useState } from "react";

import { api, type Session, type Task } from "@/lib/api";

import { agentLabel } from "../agents";
import Modal from "../Modal";
import { Chip, Field, StatusIcon } from "../primitives";

/** Inspector for one task: its brief, its gate, its review and its actions. */
export default function TaskDetail({
  task,
  titles,
  session,
  verifier,
  onChanged,
  onEdit,
  onOpenTerminal,
}: {
  task: Task;
  /** Task id → title, for naming dependencies. */
  titles: Record<string, string>;
  session: Session | null;
  /** The read-only review run, when one has been spawned. */
  verifier: Session | null;
  onChanged: () => void;
  onEdit: () => void;
  onOpenTerminal: (sessionId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      setError(null);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const ready = task.blocked_by.length === 0 && !task.session_id && task.status !== "done";
  const inReview = task.status === "review";

  return (
    <>
      <div className="cg-fields">
        <Field label="Task">{task.title}</Field>
        <Field label="Role">{task.role}</Field>
        <Field label="Agent">{agentLabel(task.agent)}</Field>
        <Field label="Status">
          <span className="cg-inline">
            {session && <StatusIcon status={session.status} />}
            {task.status}
          </span>
        </Field>
        <Field label="Scope">{task.scope.length > 0 ? task.scope.join(", ") : "—"}</Field>
        <Field label="Contract">{task.contract ?? "—"}</Field>
        <Field label="Depends on">
          {task.depends_on.length > 0
            ? task.depends_on.map((id) => titles[id] ?? id).join(", ")
            : "—"}
        </Field>
        <Field label="Blocked by">
          {task.blocked_by.length > 0 ? (
            <Chip tone="warn">{task.blocked_by.map((id) => titles[id] ?? id).join(", ")}</Chip>
          ) : (
            "—"
          )}
        </Field>
        <Field label="Port">{session?.port ?? "—"}</Field>
        <Field label="Context">{task.tokens > 0 ? `${task.tokens} tokens` : "—"}</Field>
      </div>

      {task.brief && <p className="cg-empty-note">{task.brief}</p>}
      {task.done_criteria && <p className="cg-empty-note">Done when: {task.done_criteria}</p>}

      <div className="cg-dock-group">
        <span className="cg-kicker">Gate</span>
        <div className="cg-inline">
          {task.gate_status ? (
            <Chip tone={task.gate_status === "pass" ? "ok" : "bad"}>
              gate {task.gate_status}
              {task.gate_exit_code !== null && task.gate_exit_code !== 0
                ? ` (exit ${task.gate_exit_code})`
                : ""}
            </Chip>
          ) : (
            <Chip>not run</Chip>
          )}
          <span className="cg-gate-command">{task.gate_command ?? "no command configured"}</span>
        </div>
        <div className="cg-dock-actions">
          <button
            type="button"
            className="cg-btn"
            disabled={busy || !task.session_id}
            title={task.session_id ? "Run the gate in this task's worktree" : "Start the task first"}
            onClick={() => void run(() => api.runTaskGate(task.id))}
          >
            Run gate
          </button>
          <button
            type="button"
            className="cg-btn"
            disabled={!task.gate_output}
            onClick={() => setGateOpen(true)}
          >
            View output
          </button>
        </div>
      </div>

      {(inReview || task.verifier_session_id) && (
        <div className="cg-dock-group">
          <span className="cg-kicker">Independent review</span>
          {task.verifier_session_id ? (
            <button
              type="button"
              className="cg-btn"
              onClick={() => onOpenTerminal(String(task.verifier_session_id))}
            >
              Open verifier{verifier?.agent ? ` (${agentLabel(verifier.agent)})` : ""}
            </button>
          ) : (
            <button
              type="button"
              className="cg-btn"
              disabled={busy || !task.session_id}
              title="Start a read-only run that reviews this diff"
              onClick={() => void run(() => api.verifyTask(task.id))}
            >
              Spawn verifier
            </button>
          )}
          {rejecting && (
            <div className="cg-inline-form">
              <input
                className="cg-text-input"
                value={reviewNote}
                onChange={(event) => setReviewNote(event.target.value)}
                placeholder="What must the implementer change?"
                aria-label="Requested changes"
              />
              <button
                type="button"
                className="cg-btn"
                disabled={!reviewNote.trim() || busy}
                onClick={() =>
                  void run(async () => {
                    await api.rejectTask(task.id, reviewNote.trim());
                    setReviewNote("");
                    setRejecting(false);
                  })
                }
              >
                Send back
              </button>
            </div>
          )}
          <div className="cg-dock-actions">
            <button
              type="button"
              className="cg-btn"
              data-variant="primary"
              disabled={busy}
              onClick={() => void run(() => api.approveTask(task.id))}
            >
              Approve
            </button>
            <button
              type="button"
              className="cg-btn"
              disabled={busy}
              onClick={() => setRejecting((value) => !value)}
            >
              Request changes
            </button>
          </div>
        </div>
      )}

      {task.review_note && <p className="cg-empty-note">Changes requested: {task.review_note}</p>}

      <div className="cg-dock-group">
        <span className="cg-kicker">Post a note</span>
        <input
          className="cg-text-input"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Tell the other runs what changed…"
          aria-label="Post a note"
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !note.trim()) return;
            void run(async () => {
              await api.postTeamMessage({ body: note.trim(), taskId: task.id });
              setNote("");
            });
          }}
        />
      </div>

      <div className="cg-dock-actions">
        <button
          type="button"
          className="cg-btn"
          data-variant="primary"
          disabled={!ready || busy}
          title={ready ? "Start this task" : "Start needs an unfinished dependency done first"}
          onClick={() => void run(() => api.startTask(task.id))}
        >
          Start task
        </button>
        <button
          type="button"
          className="cg-btn"
          disabled={task.status === "done" || busy}
          title="Run the gate, then wait for review"
          onClick={() => void run(() => api.completeTask(task.id))}
        >
          Mark done
        </button>
        <button
          type="button"
          className="cg-btn"
          disabled={!task.session_id || busy}
          onClick={() => task.session_id && onOpenTerminal(task.session_id)}
        >
          Open terminal
        </button>
        <button type="button" className="cg-btn" disabled={busy} onClick={onEdit}>
          Edit task
        </button>
        <button
          type="button"
          className="cg-btn"
          data-variant="danger"
          data-wide="true"
          disabled={busy}
          onClick={() => void run(() => api.deleteTask(task.id))}
        >
          Delete task
        </button>
      </div>

      {error && (
        <p className="cg-pane-error" role="alert">
          {error}
        </p>
      )}

      {gateOpen && task.gate_output && (
        <Modal
          title="Gate output"
          subtitle={task.gate_command ?? undefined}
          size="lg"
          onClose={() => setGateOpen(false)}
          footer={
            <button type="button" className="cg-btn" onClick={() => setGateOpen(false)}>
              Close
            </button>
          }
        >
          <pre className="cg-gate-output">{task.gate_output}</pre>
        </Modal>
      )}
    </>
  );
}
