import { useEffect, useState, type FormEvent } from "react";
import { projectApi } from "@/shared/api";
import type { Preflight } from "../../shared/knowledge";

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
    category?: string,
    model?: string,
  ) => Promise<void>;
  initialAgent?: string;
  title?: string;
  projectPath?: string;
  onClose: () => void;
};

export default function NewRunDialog({ onStart, initialAgent, title = "New agent", projectPath, onClose }: NewRunDialogProps) {
  const [name, setName] = useState("");
  const [agent, setAgent] = useState(initialAgent ?? DEFAULT_AGENT);
  const [model, setModel] = useState("");
  const [roleId, setRoleId] = useState("");
  const [scope, setScope] = useState("");
  const [category, setCategory] = useState("");
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!projectPath) return;
    let alive = true;
    setPreflight(null); setDismissed(false);
    const timer = window.setTimeout(() => {
      void projectApi(projectPath).knowledgePreflight(projectPath, category, scope.split(",").map(p => p.trim()).filter(Boolean), name)
        .then(value => { if (alive) { setPreflight(value); setPreflightError(null); } })
        .catch(() => { if (alive) setPreflightError("Project guidance is temporarily unavailable. You can still start this task."); });
    }, 350);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [projectPath, name, category, scope]);
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
        category.trim(),
        model.trim() || undefined,
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
        <label htmlFor="cg-task-category">Category <small>(optional)</small></label>
        <input id="cg-task-category" maxLength={80} list="cg-task-categories" value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. Authentication" />
        <datalist id="cg-task-categories">{[...new Set(["Authentication", "UI", "Database", "Testing", "Deployment", "Bug fix", ...(preflight?.suggested_categories ?? [])])].map(c => <option key={c} value={c} />)}</datalist>
        {!!preflight?.suggested_categories.length && !category && <p className="cg-form-note">Suggested: {preflight.suggested_categories.map(c => <button type="button" className="cg-btn cg-btn-sm" key={c} onClick={() => setCategory(c)}>{c}</button>)}</p>}
        {preflightError && <p role="status" className="cg-form-note">{preflightError}</p>}
        {!dismissed && preflight && (preflight.warnings.length > 0 || preflight.lessons.length > 0) && <aside className="cg-preflight" aria-label="Previous task guidance"><strong>Before you start</strong>
          {preflight.warnings.map(w => <p key={w.session_id}>{w.name}: {w.rating}/5 · {w.tags.join(", ") || "Needs improvement"}{w.note ? ` — ${w.note}` : ""}</p>)}
          {preflight.lessons.map(l => <p key={l.id}>Approved: {l.instruction}</p>)}
          <button type="button" className="cg-btn cg-btn-sm" onClick={() => setDismissed(true)}>Dismiss</button></aside>}
        <label htmlFor="cg-new-agent-cli">Agent</label>
        <div className="cg-select-control"><select id="cg-new-agent-cli" value={agent} onChange={(event) => setAgent(event.target.value)}>
          {AGENTS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select><LuChevronDown aria-hidden="true" /></div>
        <p className="cg-form-note">Your changes start in a separate workspace. Location and roles are under Advanced.</p>
        <details className="cg-agent-advanced"><summary>Advanced</summary><div className="cg-agent-advanced-fields">
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
        <label htmlFor="cg-new-agent-role">Role</label>
        <div className="cg-select-control"><select id="cg-new-agent-role" value={roleId} onChange={(event) => setRoleId(event.target.value)}>
          <option value="">No role</option>
          {ROLES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select><LuChevronDown aria-hidden="true" /></div>
        {role && <p className="cg-form-note">Loaded skills: {roleSkills(role).map((skill) => skill.label).join(", ")}</p>}
        <label htmlFor="cg-new-agent-model">Model <small>(optional)</small></label>
        <input id="cg-new-agent-model" value={model} onChange={(event) => setModel(event.target.value)} placeholder="e.g. gpt-4.1" />
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
