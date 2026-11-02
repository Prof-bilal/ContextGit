import { useEffect, useRef, useState } from "react";
import { LuArrowRight, LuChevronDown, LuRefreshCw, LuUsers, LuX } from "react-icons/lu";
import { projectApi } from "@/shared/api";
import { harnessFor } from "@/shared/harnesses";
import { RunSkills, type RunSkill } from "./RunSkills";
import "./team-create.css";

export const TEAM_CLIS = ["codex", "claude", "opencode", "commandcode"];
type Catalog = Awaited<ReturnType<ReturnType<typeof projectApi>["harnessModels"]>>;
const catalogs = new Map<string, Catalog>();

function ModelPicker({ agent, project, value, onChange, disabled, label }: {
  agent: string; project: string; value: string; onChange: (value: string) => void;
  disabled: boolean; label: string;
}) {
  const [data, setData] = useState<Catalog | null>(catalogs.get(agent) ?? null);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [custom, setCustom] = useState(false);
  useEffect(() => {
    let active = true;
    setCustom(false);
    setData(catalogs.get(agent) ?? null);
    setLoading(true);
    void projectApi(project).harnessModels(agent).then(result => {
      if (active) { catalogs.set(agent, result); setData(result); }
    }).catch(() => {
      if (active) setData({ models: [], source: "unavailable", message: "Could not load models. Use the CLI default or enter a custom ID." });
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [agent, project, revision]);
  const isCustom = custom || (!!value && !!data && !data.models.some(model => model.id === value));
  return <div className="tc-model">
    <label>{label}<span className="tc-model-control">
      <select aria-label={label} disabled={disabled || loading} value={isCustom ? "__custom__" : value}
        onChange={event => { const next = event.target.value; setCustom(next === "__custom__"); onChange(next === "__custom__" ? "" : next); }}>
        <option value="">{loading ? "Loading models…" : "CLI default"}</option>
        {data?.models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
        <option value="__custom__">Custom model ID…</option>
      </select><LuChevronDown aria-hidden="true" />
    </span></label>
    <button className="tc-refresh" type="button" aria-label={`Refresh ${harnessFor(agent)?.label} models`} disabled={disabled || loading} onClick={() => setRevision(value => value + 1)}><LuRefreshCw /></button>
    {isCustom && <input aria-label={`${label} custom ID`} placeholder="Exact model ID" value={value} disabled={disabled} onChange={event => onChange(event.target.value)} />}
    <small>{data?.message ?? "Uses your CLI's configured model unless you choose another."}</small>
  </div>;
}

export function TeamCreateDialog(props: {
  project: string; name: string; onName: (value: string) => void;
  goal: string; onGoal: (value: string) => void;
  orchestrator: string; onOrchestrator: (value: string) => void;
  models: Record<string, string>; onModel: (agent: string, model: string) => void;
  workerModels: Record<string, string>; onWorkerModel: (agent: string, model: string) => void;
  installed: string[]; checking: boolean; allowed: string[]; onAllowed: (value: string[]) => void;
  concurrency: number; onConcurrency: (value: number) => void;
  skills: RunSkill[]; onSkills: (value: RunSkill[]) => void; onSkillsLoading: (value: boolean) => void;
  busy: boolean; skillsLoading: boolean; error: string | null; onClose: () => void; onCreate: () => void;
}) {
  const root = useRef<HTMLFormElement>(null);
  const close = useRef(props.onClose); close.current = props.onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLInputElement>('input[name="team-name"]')?.focus();
    return () => before?.focus();
  }, []);
  return <div className="sp-modal-backdrop tc-backdrop">
    <form ref={root} className="tc-dialog" role="dialog" aria-modal="true" aria-label="Create a team"
      onSubmit={event => { event.preventDefault(); props.onCreate(); }} onKeyDown={event => {
        if (event.key === "Escape" && !props.busy) { event.preventDefault(); close.current(); }
        if (event.key === "Tab") {
          const items = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary') ?? []).filter(item => item.getClientRects().length);
          const first = items[0], last = items[items.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <header className="tc-heading"><span className="tc-heading-icon"><LuUsers /></span><div><h2>Create a team</h2><p>A parent plans. You approve. Agents work together.</p></div><button type="button" aria-label="Cancel team creation" disabled={props.busy} onClick={props.onClose}><LuX /></button></header>
      <div className="tc-body">
        <div className="tc-project"><span>Project</span><strong title={props.project}>{props.project.split(/[\\/]/).filter(Boolean).pop()}</strong><small>Isolated worktrees · no automatic push</small></div>
        <label>Team name<input name="team-name" value={props.name} disabled={props.busy} onChange={event => props.onName(event.target.value)} placeholder="e.g. Security review" required /></label>
        <section className="tc-parent"><div className="tc-section-title"><span>01</span><div><h3>Parent agent</h3><p>Explores the task, proposes workers, and reviews their work.</p></div></div>
          <div className="tc-cli-tabs" role="group" aria-label="Orchestrator CLI">
            {TEAM_CLIS.map(agent => <button type="button" key={agent} aria-pressed={props.orchestrator === agent} disabled={props.busy || props.checking || !props.installed.includes(agent)} title={!props.installed.includes(agent) ? "Not installed" : harnessFor(agent)?.label} onClick={() => props.onOrchestrator(agent)}><span>{harnessFor(agent)?.monogram}</span>{harnessFor(agent)?.label}</button>)}
          </div>
          <ModelPicker agent={props.orchestrator} project={props.project} label="Parent model" value={props.models[props.orchestrator] ?? ""} onChange={value => props.onModel(props.orchestrator, value)} disabled={props.busy} />
          {props.checking && <small role="status">Checking installed CLIs…</small>}
        </section>
        <section><div className="tc-section-title"><span>02</span><div><h3>What should the team do?</h3><p>Describe the outcome. The parent chooses the worker count.</p></div></div>
          <label className="tc-goal"><span className="tc-sr-only">Goal</span><textarea value={props.goal} disabled={props.busy} onChange={event => props.onGoal(event.target.value)} required rows={4} placeholder="Describe the task, constraints, and what a good result looks like…" /></label>
        </section>
        <details className="tc-workers" open><summary><div><h3>Worker settings</h3><p>{props.allowed.length} allowed CLIs · up to {props.concurrency} active workers</p></div><LuChevronDown /></summary>
          <label className="tc-concurrency">Maximum active workers<span><input aria-label="Maximum active workers" type="number" min={1} max={12} value={props.concurrency} disabled={props.busy} onChange={event => props.onConcurrency(Math.max(1, Math.min(12, Number(event.target.value) || 1)))} /><small>Others wait in the queue</small></span></label>
          <div className="tc-worker-list">{TEAM_CLIS.map(agent => <div className="tc-worker" key={agent}>
            <label className="tc-worker-toggle"><input type="checkbox" checked={props.allowed.includes(agent)} disabled={props.busy || !props.installed.includes(agent)} onChange={event => props.onAllowed(event.target.checked ? [...props.allowed, agent] : props.allowed.filter(value => value !== agent))} /><span>{harnessFor(agent)?.label}<small>{props.installed.includes(agent) ? "Installed" : "Not installed"}</small></span></label>
            {props.allowed.includes(agent) && <ModelPicker agent={agent} project={props.project} label={`${harnessFor(agent)?.label} worker model`} value={props.workerModels[agent] ?? ""} onChange={value => props.onWorkerModel(agent, value)} disabled={props.busy} />}
          </div>)}</div>
        </details>
        <details className="tc-skills"><summary><div><h3>Skills <span>Optional</span></h3><p>{props.skills.length ? `${props.skills.length} selected` : "Add reusable instructions for the team"}</p></div><LuChevronDown /></summary><RunSkills project={props.project} selected={props.skills} onChange={props.onSkills} disabled={props.busy} onLoading={props.onSkillsLoading} /></details>
        {props.error && <p className="tc-error" role="alert">{props.error}</p>}
      </div>
      <footer className="tc-footer"><p>Only the parent starts now.<br /><strong>Workers wait for your approval.</strong></p><button className="tc-cancel" type="button" disabled={props.busy} onClick={props.onClose}>Cancel</button><button className="tc-primary" disabled={props.busy || props.checking || props.skillsLoading || !props.name.trim() || !props.goal.trim() || !props.allowed.length || !props.installed.includes(props.orchestrator)}>{props.busy ? "Starting parent…" : "Create and propose plan"}<LuArrowRight /></button></footer>
    </form>
  </div>;
}
