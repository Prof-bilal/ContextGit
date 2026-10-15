import { useState, type FormEvent } from "react";

import { ROLE_BY_ID, ROLES, roleSkills } from "../../shared/roles";
import { AGENTS, DEFAULT_AGENT } from "./agents";
import Modal from "./Modal";
import { LuChevronDown, LuFolder, LuGitBranch } from "react-icons/lu";

type NewRunDialogProps = {
  onStart: (
    name: string,
    agent: string,
    scope: string[],
    roleId: string,
    worktree: boolean,
  ) => Promise<void>;
  initialAgent?: string;
  title?: string;
  onClose: () => void;
};

export default function NewRunDialog({ onStart, initialAgent, title = "New agent", onClose }: NewRunDialogProps) {
  const [name, setName] = useState("");
  const [agent, setAgent] = useState(initialAgent ?? DEFAULT_AGENT);
  const [roleId, setRoleId] = useState("");
  const [scope, setScope] = useState("");
  const [worktree, setWorktree] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const role = roleId ? ROLE_BY_ID[roleId] : undefined;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onStart(
        trimmed,
        agent,
        scope.split(",").map((part) => part.trim()).filter(Boolean),
        roleId,
        worktree,
      );
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the agent");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose} size="sm">
      <form className="cg-form cg-new-agent-form" onSubmit={(event) => void submit(event)}>
        <label htmlFor="cg-new-agent-name">Run name</label>
        <input id="cg-new-agent-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. fix auth bug" autoFocus />
        <label htmlFor="cg-new-agent-cli">Agent</label>
        <div className="cg-select-control"><select id="cg-new-agent-cli" value={agent} onChange={(event) => setAgent(event.target.value)}>
          {AGENTS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select><LuChevronDown aria-hidden="true" /></div>
        <fieldset className="cg-run-location" aria-describedby="cg-run-location-help">
          <legend>Working folder</legend>
          <div className="cg-run-location-tabs">
          <label className="cg-run-location-tab">
            <input
              type="radio"
              name="cg-run-location"
              checked={worktree}
              onChange={() => setWorktree(true)}
            />
            <span><LuGitBranch aria-hidden="true" />Isolated worktree</span>
          </label>
          <label className="cg-run-location-tab">
            <input
              type="radio"
              name="cg-run-location"
              checked={!worktree}
              onChange={() => setWorktree(false)}
            />
            <span><LuFolder aria-hidden="true" />Project root</span>
          </label>
          </div>
          <p id="cg-run-location-help" className="cg-run-location-help">
            {worktree ? <>Recommended for edits. Uses its own branch and checkout.</> : <>Shares the selected folder and its uncommitted changes with other tools.</>}
          </p>
        </fieldset>
        <details className="cg-agent-advanced"><summary>Advanced</summary><div className="cg-agent-advanced-fields">
        <label htmlFor="cg-new-agent-role">Role</label>
        <div className="cg-select-control"><select id="cg-new-agent-role" value={roleId} onChange={(event) => setRoleId(event.target.value)}>
          <option value="">No role</option>
          {ROLES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select><LuChevronDown aria-hidden="true" /></div>
        {role && <p className="cg-form-note">Loaded skills: {roleSkills(role).map((skill) => skill.label).join(", ")}</p>}
        <label htmlFor="cg-new-agent-scope">Own files <span>(optional)</span></label>
        <input id="cg-new-agent-scope" value={scope} onChange={(event) => setScope(event.target.value)} placeholder="src/**, docs/**" />
        </div></details>
        {error && <p className="cg-form-warn" role="alert">{error}</p>}
        <div className="cg-modal-actions">
          <button type="button" className="cg-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="cg-btn" data-variant="primary" disabled={!name.trim() || busy}>{busy ? "Starting…" : "Start agent"}</button>
        </div>
      </form>
    </Modal>
  );
}
