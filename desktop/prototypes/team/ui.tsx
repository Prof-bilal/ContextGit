import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Background, Controls, Handle, Position, ReactFlow, useNodesState, useNodesInitialized, useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { LuArrowRight, LuBot, LuCheck, LuChevronRight, LuCircleAlert, LuCode, LuFileDiff, LuFolder, LuGitBranch, LuGitMerge, LuGrip, LuLayers, LuMaximize2, LuPause, LuPlay, LuPlus, LuRotateCcw, LuSearch, LuShieldCheck, LuSparkles, LuTerminal, LuUsers, LuX } from 'react-icons/lu';
import { CLIS, INSTALLED, SKILLS, defaultConfig, validatePlan, type Action, type Config, type Scenario, type Skill, type State, type TeamAdapter, type Worker } from './model';

const scenarioLabels: Record<Scenario, string> = { normal: 'Happy path', amendment: 'Added worker approval', 'missing-cli': 'Missing CLI', 'worker-failure': 'Worker needs correction', 'merge-conflict': 'Integration conflict', 'check-failure': 'Combined checks fail' };
const phaseLabels: Record<State['phase'], string> = { empty: 'Ready to create', planning: 'Parent is planning', review: 'Awaiting your approval', running: 'Team is working', paused: 'Scheduling paused', blocked: 'Integration blocked', complete: 'Ready to merge' };
const statusLabels = { queued: 'Queued', working: 'Working', reviewing: 'Parent review', failed: 'Needs correction', accepted: 'Integration queued', integrated: 'Integrated' };
function SkillTree({ skills }: { skills: Skill[] }) {
  if (!skills.length) return null;
  return <div className="skill-tree"><div className="skill-tree-title"><LuSparkles /> Skills <span>{skills.length}</span></div><ul>{skills.map(skill => <li key={skill.id} title={skill.instruction}>{skill.title}<small>{skill.origin}</small></li>)}</ul></div>;
}
function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) { return <span className={`badge ${tone}`}>{children}</span>; }
function Dialog({ title, subtitle, children, close, wide = false }: { title: string; subtitle?: string; children: ReactNode; close: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('button,input,select,textarea')?.focus());
    return () => { cancelAnimationFrame(frame); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}><div ref={ref} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onKeyDown={e => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Tab') {
      const focusable = [...ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]')];
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  }}><header className="modal-heading"><div><p className="eyebrow">TEAM WORKSPACE</p><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label={`Close ${title}`} onClick={close}><LuX /></button></header>{children}</div></div>;
}
function SkillPicker({ value, change }: { value: Skill[]; change: (skills: Skill[]) => void }) {
  const [filter, setFilter] = useState('all'), [search, setSearch] = useState('');
  return <fieldset className="skill-picker"><legend>Skills <span>{value.length} selected</span></legend><div className="picker-tools"><select aria-label="Skill source" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All skills</option><option>built-in</option><option>project</option><option>global</option></select><div className="search-input"><LuSearch /><input placeholder="Search skills" aria-label="Search skills" value={search} onChange={e => setSearch(e.target.value)} /></div></div><div className="picker-list">{SKILLS.filter(skill => (filter === 'all' || skill.origin === filter) && skill.title.toLowerCase().includes(search.toLowerCase())).map(skill => <label className="skill-choice" key={skill.id}><input type="checkbox" checked={value.some(item => item.id === skill.id)} onChange={e => change(e.target.checked ? [...value, skill] : value.filter(item => item.id !== skill.id))} /><span>{skill.title}<small>{skill.origin} · {skill.instruction}</small></span></label>)}</div><small>Approved demo skills. Instructions are snapshotted when approved.</small></fieldset>;
}
function CreateTeam({ close, create }: { close: () => void; create: (config: Config) => void }) {
  const [config, setConfig] = useState<Config>(structuredClone(defaultConfig));
  const patch = (value: Partial<Config>) => setConfig(current => ({ ...current, ...value }));
  return <Dialog title="Create a team" subtitle="Describe the outcome. Your parent agent will plan the team." close={close}>
    <form onSubmit={e => { e.preventDefault(); create(config); }}>
      <div className="form-grid"><label>Project<select value={config.project} onChange={e => patch({ project: e.target.value })}><option>ContextGit</option><option>Storefront</option></select></label><label>Team name<input required value={config.name} onChange={e => patch({ name: e.target.value })} /></label></div>
      <label>What should the team accomplish?<textarea required rows={3} value={config.goal} onChange={e => patch({ goal: e.target.value })} /></label>
      <div className="form-grid"><label>Parent agent<select value={config.parent} onChange={e => patch({ parent: e.target.value })}>{CLIS.map(cli => <option key={cli} disabled={!INSTALLED.includes(cli)}>{cli}</option>)}</select></label><label>Maximum active workers<input type="number" min={1} max={12} required value={config.concurrency} onChange={e => patch({ concurrency: Number(e.target.value) })} /></label></div>
      <fieldset className="cli-picker"><legend>Allowed worker CLIs</legend>{CLIS.map(cli => <label key={cli}><input type="checkbox" disabled={!INSTALLED.includes(cli)} checked={config.allowed.includes(cli)} onChange={e => patch({ allowed: e.target.checked ? [...config.allowed, cli] : config.allowed.filter(value => value !== cli) })} />{cli}<small>{INSTALLED.includes(cli) ? 'Installed (simulated)' : 'Not installed'}</small></label>)}</fieldset>
      <SkillPicker value={config.skills} change={skills => patch({ skills })} />
      <div className="notice"><LuShieldCheck /><span>No workers start until you approve the plan. Each agent gets its own worktree.</span></div>
      <footer className="modal-footer"><button type="button" onClick={close}>Cancel</button><button className="primary" type="submit" disabled={!config.allowed.length}>Create & plan <LuArrowRight /></button></footer>
    </form>
  </Dialog>;
}
function PlanReview({ state, act, close }: { state: State; act: (action: Action) => void; close: () => void }) {
  const [note, setNote] = useState('');
  const errors = validatePlan(state.workers, state.config);
  return <Dialog title="Review the team plan" subtitle={`Revision ${state.revision} · Proposed by ${state.config.parent} · No workers launched`} close={close} wide>
    <div className="plan-rationale"><LuSparkles /><div><strong>{state.workers.length} focused workers, one coordinated outcome.</strong><p>The service and interface can work independently. Validation waits for their integrated results. The parent owns review and integration.</p></div></div>
    <div className="completion-criteria"><strong>Team completion criteria</strong><p>{state.config.goal} All worker criteria and combined checks must pass on the team integration branch.</p></div>
    <div className="plan-list">{state.workers.map((worker, i) => <article className="plan-worker" key={worker.id}>
      <header><span className="number">{String(i + 1).padStart(2, '0')}</span><strong>{worker.id}</strong><button className="icon-button" aria-label={`Remove ${worker.id}`} onClick={() => act({ type: 'remove', id: worker.id })}><LuX /></button></header>
      <div className="form-grid"><label>Task<input value={worker.title} onChange={e => act({ type: 'edit', id: worker.id, patch: { title: e.target.value } })} /></label><label>Role<input value={worker.role} onChange={e => act({ type: 'edit', id: worker.id, patch: { role: e.target.value } })} /></label></div>
      <label>Why this worker?<textarea rows={2} value={worker.reason} onChange={e => act({ type: 'edit', id: worker.id, patch: { reason: e.target.value } })} /></label>
      <div className="form-grid"><label>CLI<select value={worker.agent} onChange={e => act({ type: 'edit', id: worker.id, patch: { agent: e.target.value } })}>{[...new Set([...state.config.allowed, worker.agent])].map(cli => <option key={cli}>{cli}</option>)}</select></label><label>File ownership<input value={worker.scope} onChange={e => act({ type: 'edit', id: worker.id, patch: { scope: e.target.value } })} /></label></div>
      <label>Dependencies <small>Worker IDs, separated by commas</small><input value={worker.dependencies.join(', ')} onChange={e => act({ type: 'edit', id: worker.id, patch: { dependencies: e.target.value.split(',').map(value => value.trim()).filter(Boolean) } })} /></label>
      <label>Done when<input value={worker.criteria} onChange={e => act({ type: 'edit', id: worker.id, patch: { criteria: e.target.value } })} /></label>
      <SkillPicker value={worker.skills} change={skills => act({ type: 'edit', id: worker.id, patch: { skills } })} />
    </article>)}</div>
    <button className="text-button" disabled={state.workers.length >= 12} onClick={() => act({ type: 'add' })}><LuPlus /> Add worker</button>
    <div className="revision-request"><label>Request a revision<input placeholder="e.g. add accessibility checks to the UI criteria" value={note} onChange={e => setNote(e.target.value)} /></label><button disabled={!note.trim()} onClick={() => { act({ type: 'revise', note }); setNote(''); }}>Revise plan</button></div>
    {!!errors.length && <div className="validation-errors" role="alert">{errors.map(error => <p key={error}><LuCircleAlert />{error}</p>)}</div>}
    <footer className="modal-footer"><span>{state.config.concurrency} active workers max · Separate worktrees</span><button className="primary" disabled={!!errors.length} onClick={() => { act({ type: 'approve' }); close(); }}>Approve and launch <LuArrowRight /></button></footer>
  </Dialog>;
}

type CardData = { state: State; worker?: Worker; selected: boolean; select: (id: string) => void; review: () => void };
type CardNode = Node<CardData>;
function AgentCard({ data }: NodeProps<CardNode>) {
  const { state, worker } = data;
  const id = worker?.id ?? 'parent';
  return <div className={`agent-card ${worker ? '' : 'parent-card'} ${data.selected ? 'selected' : ''}`}>
    {worker && <Handle type="target" position={Position.Top} />}
    <button className="agent-card-body nodrag" onClick={() => data.select(id)} aria-label={`Inspect ${worker?.title ?? 'parent agent'}`}>
      <div className="agent-card-top"><span className={`agent-avatar ${worker ? '' : 'parent-avatar'}`}><LuBot /></span><span className="agent-identity"><strong>{worker?.title ?? 'Parent orchestrator'}</strong><small>{worker?.agent ?? state.config.parent} · {worker?.role ?? 'Plan, coordinate & review'}</small></span><LuMaximize2 className="open-icon" /></div>
      <div className="card-status"><Badge tone={worker?.status === 'failed' ? 'warn' : worker?.status === 'integrated' ? 'success' : ''}>{worker ? statusLabels[worker.status] : phaseLabels[state.phase]}</Badge><span>{worker ? `${worker.progress}%` : 'Parent'}</span></div>
      <div className="progress-track"><i style={{ width: `${worker?.progress ?? (state.phase === 'planning' ? state.planningStep * 33 : 100)}%` }} /></div>
      <p className="agent-card-note">{worker ? (worker.status === 'queued' ? (worker.dependencies.length ? 'Waiting for prerequisite integration' : 'Waiting for an available slot') : worker.reviews.at(-1) ?? worker.log.at(-1) ?? worker.reason) : state.phase === 'planning' ? ['Reading the task and exploring the project…', 'Inspecting structure and conventions…', 'Mapping ownership and dependencies…'][Math.min(state.planningStep, 2)] : state.phase === 'review' ? `${state.workers.length} workers proposed. Your approval is required.` : state.phase === 'complete' ? 'All results reviewed. Integration checks passed.' : 'Monitoring workers, reviewing results, and integrating changes.'}</p>
      <div className="card-meta"><LuGitBranch /><span>{worker ? `.worktrees/${state.id}/${worker.id}` : state.integrationBranch}</span></div>
    </button>
    {!worker && state.phase === 'review' && <button className="review-plan-button nodrag" onClick={data.review}>Review proposed plan <LuArrowRight /></button>}
    <SkillTree skills={worker?.skills ?? state.config.skills} />
    {!worker && <Handle type="source" position={Position.Bottom} />}
    {worker && <Handle type="source" position={Position.Bottom} id="dependency" />}
  </div>;
}
function Boundary({ data }: NodeProps<CardNode>) { return <div className="team-boundary"><div className="boundary-label"><LuGrip /><LuUsers /><strong>{data.state.config.name}</strong><span>TEAM / {data.state.id}</span></div></div>; }
const nodeTypes = { agent: AgentCard, boundary: Boundary };
function CanvasFit({ layoutKey }: { layoutKey: string }) {
  const ready = useNodesInitialized();
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (!ready) return;
    let timer: ReturnType<typeof setTimeout>;
    const fit = () => { clearTimeout(timer); timer = setTimeout(() => void fitView({ padding: .12, duration: 0 }), 90); };
    fit(); window.addEventListener('resize', fit);
    return () => { clearTimeout(timer); window.removeEventListener('resize', fit); };
  }, [ready, layoutKey, fitView]);
  return null;
}
function TeamCanvas({ state, selected, select, review }: { state: State; selected: string; select: (id: string) => void; review: () => void }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<CardNode>([]);
  useEffect(() => {
    const width = Math.max(760, Math.min(state.workers.length, 3) * 350 + 60);
    const height = 440 + Math.ceil(state.workers.length / 3) * 430;
    setNodes(old => {
      const existing = new Map(old.map(node => [node.id, node.position]));
      const data = { state, selected: false, select, review };
      return [
        { id: 'team', type: 'boundary', position: existing.get('team') ?? { x: 30, y: 20 }, data, style: { width, height, zIndex: 0 }, dragHandle: '.boundary-label', draggable: true, selectable: false },
        { id: 'parent', type: 'agent', parentId: 'team', extent: 'parent' as const, position: { x: width / 2 - 150, y: 65 }, draggable: false, data: { ...data, selected: selected === 'parent' }, style: { width: 300, zIndex: 2 } },
        ...state.workers.map((worker, i) => ({ id: worker.id, type: 'agent', parentId: 'team', extent: 'parent' as const, position: existing.get(worker.id) ?? { x: 30 + (i % 3) * 350, y: 440 + Math.floor(i / 3) * 430 }, data: { ...data, worker, selected: selected === worker.id }, style: { width: 300, zIndex: 2 } })),
      ];
    });
  }, [state, selected, select, review, setNodes]);
  const edges = useMemo(() => state.workers.flatMap(worker => [
    { id: `parent-${worker.id}`, source: 'parent', target: worker.id, type: 'smoothstep', animated: worker.status === 'working', style: { stroke: '#9f6543', strokeWidth: 1.5 } },
    ...worker.dependencies.map(dep => ({ id: `${dep}-${worker.id}`, source: dep, sourceHandle: 'dependency', target: worker.id, type: 'smoothstep', animated: false, style: { stroke: '#7b8881', strokeWidth: 1.5, strokeDasharray: '5 5' } })),
  ]), [state.workers]);
  return <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} fitView fitViewOptions={{ padding: .16 }} minZoom={.15} maxZoom={1.4} colorMode="dark" proOptions={{ hideAttribution: true }}><CanvasFit layoutKey={`${state.workers.length}:${Boolean(selected)}`} /><Background color="#554339" gap={24} size={1.5} /><Controls showInteractive={false} /></ReactFlow>;
}
function Inspector({ state, selected, close, act }: { state: State; selected: string; close: () => void; act: (action: Action) => void }) {
  const [tab, setTab] = useState('Overview');
  const worker = state.workers.find(item => item.id === selected);
  const logs = worker?.log ?? state.events.map(event => `${event.time} ${event.text}`).reverse();
  return <aside className="inspector"><header><span><LuBot />{worker ? 'Worker details' : 'Parent details'}</span><button className="icon-button" aria-label="Close inspector" onClick={close}><LuX /></button></header><div className="inspector-intro"><span className="agent-avatar"><LuBot /></span><h2>{worker?.title ?? 'Parent orchestrator'}</h2><p>{worker?.role ?? `${state.config.parent} · Team lead`}</p><Badge tone={worker?.status === 'failed' ? 'warn' : ''}>{worker ? statusLabels[worker.status] : phaseLabels[state.phase]}</Badge></div><div className="inspector-tabs" role="tablist">{['Overview', 'Terminal', 'Review'].map(name => <button role="tab" aria-selected={tab === name} key={name} onClick={() => setTab(name)}>{name}</button>)}</div>
    <div className="inspector-content" role="tabpanel" aria-label={tab}>
      {tab === 'Overview' && <><p className="eyebrow">INSTRUCTIONS</p><p>{worker?.reason ?? `Inspect the project, propose a bounded plan, and wait for user approval. Coordinate only approved workers. Review their diffs and checks, then integrate accepted commits into ${state.integrationBranch}.`}</p><p className="eyebrow">DONE WHEN</p><p>{worker?.criteria ?? state.config.goal}</p><p className="eyebrow">WORKTREE</p><code>.worktrees/{state.id}/{worker?.id ?? 'parent'}</code><p className="eyebrow">STARTING COMMIT</p><code>{worker?.baseCommit ?? state.integrationHead}</code>{worker && <><p className="eyebrow">FILE OWNERSHIP</p><code>{worker.scope}</code><p className="eyebrow">DEPENDENCIES</p><p>{worker.dependencies.join(', ') || 'Independent worker'}</p><p className="eyebrow">LATEST RESULT</p><p>{worker.log.at(-1) ?? 'No result yet.'}</p></>}<SkillTree skills={worker?.skills ?? state.config.skills} /></>}
      {tab === 'Terminal' && <><div className="terminal-heading"><LuTerminal /> Simulated terminal · read only</div><pre className="terminal-output">{logs.length ? logs.map(line => `› ${line}`).join('\n\n') : 'Waiting for approved launch…'}</pre></>}
      {tab === 'Review' && <><p className="eyebrow">PARENT REVIEW HISTORY</p>{worker ? (worker.reviews.length ? worker.reviews.map((review, i) => <div className="review-entry" key={i}><LuShieldCheck /><p>{review}</p></div>) : <p>No review yet. Terminal exit alone does not mark work complete.</p>) : <p>The parent reviews evidence before accepting work. The integration branch is checked again after every merge.</p>}</>}
      {worker?.status === 'failed' && <button className="primary" onClick={() => act({ type: 'retry', id: worker.id })}>Request correction <LuRotateCcw /></button>}
    </div>
  </aside>;
}
function MergeReview({ state, close, act }: { state: State; close: () => void; act: (action: Action) => void }) {
  return <Dialog title="Review merge into main" subtitle="Simulated final review · No real Git operations" close={close} wide><div className="merge-summary"><LuGitMerge /><div><strong>{state.integrationBranch} <LuArrowRight /> main</strong><p>{state.workers.length} workers reviewed · Combined checks passed · No remote push</p></div></div><p>The parent accepted and integrated every worker result. You control the final merge into main.</p><div className="check-list"><span><LuCheck /> Worker reviews passed</span><span><LuCheck /> Combined validation passed</span><span><LuCheck /> Integration branch is clean</span></div><div className="diff-preview">{state.workers.map(worker => <section key={worker.id}><header><LuFileDiff />{worker.scope} <code>{worker.commit}</code></header><pre><span>+ // Simulated change: {worker.title}</span>{'\n'}<span>+ // {worker.criteria}</span></pre></section>)}</div><footer className="modal-footer"><span>This only updates the demo.</span><button className="primary" disabled={state.mainMerged} onClick={() => { act({ type: 'confirm-main' }); close(); }}>{state.mainMerged ? 'Already merged in demo' : 'Confirm simulated merge'}<LuGitMerge /></button></footer></Dialog>;
}
export default function TeamPrototype({ adapter }: { adapter: TeamAdapter }) {
  const state = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
  const [modal, setModal] = useState<'create' | 'plan' | 'merge' | 'standalone' | null>(null);
  const [selected, setSelected] = useState(''), [showActivity, setShowActivity] = useState(true), [auto, setAuto] = useState(true), [error, setError] = useState('');
  const [newScenario, setNewScenario] = useState<Scenario | null>(null);
  const act = (action: Action) => { try { adapter.dispatch(action); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } };
  useEffect(() => {
    if (!auto || !['planning', 'running'].includes(state.phase)) return;
    const timer = setInterval(() => adapter.dispatch({ type: 'tick' }), 1800);
    return () => clearInterval(timer);
  }, [adapter, auto, state.phase]);
  // Stable callbacks prevent resetting canvas positions as other controls render.
  const selectAgent = useMemo(() => (id: string) => setSelected(id), []);
  const reviewPlan = useMemo(() => () => setModal('plan'), []);
  const integrated = state.workers.filter(worker => worker.status === 'integrated').length;
  const active = state.workers.filter(worker => ['working', 'reviewing', 'accepted'].includes(worker.status)).length;
  const progress = state.workers.length ? Math.round(state.workers.reduce((sum, worker) => sum + (worker.status === 'integrated' ? 100 : worker.progress * .8), 0) / state.workers.length) : 0;
  function reset(scenario: Scenario) { adapter.reset(scenario); setSelected(''); setError(''); setModal(null); setNewScenario(null); }
  return <div className="prototype-app">
    <aside className="project-rail"><a className="brand" href="./" aria-label="ContextGit prototype home"><span className="brand-symbol">c<span>g</span></span><strong>ContextGit<span>WORKSPACE</span></strong></a><div className="rail-project"><LuFolder /><div><strong>{state.config.project}</strong><small>Local project · demo</small></div><LuChevronRight /></div><p className="rail-label">WORKBENCH</p><button className="rail-item" onClick={() => setModal('standalone')}><LuTerminal /> Run agent</button><button className="rail-item active" onClick={() => setModal(state.phase === 'empty' ? 'create' : 'plan')} disabled={state.phase !== 'empty' && state.phase !== 'review'}><LuUsers /> Team mode <Badge>Preview</Badge></button><div className="rail-teams"><p className="rail-label">YOUR TEAMS</p>{state.id ? <button className="rail-team" onClick={() => setSelected('parent')}><span className="team-dot" /><span>{state.config.name}<small>{phaseLabels[state.phase]}</small></span></button> : <p className="rail-empty">Your next big task starts<br />with a small, focused team.</p>}</div><div className="rail-bottom"><LuShieldCheck /><p>Prototype sandbox<small>Simulated agents and Git.<br />Your projects stay untouched.</small></p></div></aside>
    <main className="workspace"><header className="workspace-header"><div className="breadcrumbs">{state.config.project}<LuChevronRight /><strong>Team mode</strong></div><div className="header-right"><Badge tone="demo"><span className="live-dot" /> Interactive prototype</Badge><span className="avatar">AB</span></div></header>
      <div className="page-heading"><div><p className="eyebrow">A LITTLE STRUCTURE. A LOT MORE MOMENTUM.</p><h1>{state.id ? state.config.name : 'One task. A coordinated team.'}</h1><p>{state.id ? state.config.goal : 'Give your agents a shared direction, with you in control.'}</p></div><button className="primary" onClick={() => state.id ? setNewScenario(state.scenario) : setModal('create')}><LuPlus /> Create team</button></div>
      <div className="demo-toolbar"><div><LuLayers /><label>Scenario<select aria-label="Demo scenario" value={state.scenario} onChange={e => state.id ? setNewScenario(e.target.value as Scenario) : reset(e.target.value as Scenario)}>{Object.entries(scenarioLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><div className="demo-toolbar-actions"><label className="auto-toggle"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /> Auto-play</label><button disabled={!['planning', 'running'].includes(state.phase)} onClick={() => act({ type: 'tick' })}><LuPlay /> Next step</button><button onClick={() => state.id ? setNewScenario(state.scenario) : reset(state.scenario)}><LuRotateCcw /> Reset</button></div></div>
      {error && <div className="error-banner" role="alert">{error}<button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><LuX /></button></div>}
      <section className="canvas-shell" aria-label="Team workspace"><div className="canvas-topbar"><div><LuUsers /><strong>{state.id ? 'Team canvas' : 'Your team canvas'}</strong><Badge tone={state.phase === 'blocked' ? 'warn' : ''}>{phaseLabels[state.phase]}</Badge></div><div>{state.id && <><span>{active}/{state.config.concurrency} active</span>{state.phase === 'running' && <button onClick={() => act({ type: 'pause' })}><LuPause /> Pause</button>}{state.phase === 'paused' && <button onClick={() => act({ type: 'resume' })}><LuPlay /> Resume</button>}</>}<button className={showActivity ? 'toggled' : ''} onClick={() => setShowActivity(value => !value)} aria-pressed={showActivity}>Activity</button></div></div>
        {state.pending.length > 0 && <div className="amendment-banner"><LuCircleAlert /><div><strong>Parent requests one more worker</strong><small>{state.pending[0].title} · {state.pending[0].scope} · No launch without your approval.</small></div><button onClick={() => act({ type: 'reject-addition' })}>Decline</button><button className="primary" onClick={() => act({ type: 'approve-addition' })}>Approve worker</button></div>}
        {state.phase === 'paused' && <div className="info-banner"><LuPause /> Scheduling and integration paused. Active terminals remain open; this demo freezes progress until resumed.</div>}
        {state.phase === 'blocked' && <div className="amendment-banner"><LuCircleAlert /><div><strong>Integration needs attention</strong><small>{state.blockedReason}</small></div><button onClick={() => act({ type: 'retry-integration' })}>Simulate fix & retry</button></div>}
        <div className="canvas-and-inspector"><div className="canvas-area">
          {state.phase === 'empty' ? <div className="empty-canvas"><div className="empty-orbit"><div className="empty-parent"><LuBot /><span>Parent agent</span><Badge>Plans first</Badge></div><div className="empty-branches"><span /><span /><span /></div><div className="empty-workers">{['Build', 'Implement', 'Validate'].map(label => <div key={label}><LuCode /><span>{label}</span></div>)}</div></div><h2>A parent with a plan.<br />A team with a purpose.</h2><p>Describe your task. Review the proposed team.<br />Let the parent coordinate the rest.</p><button className="primary" onClick={() => setModal('create')}><LuPlus /> Create your first team</button><div className="empty-promises"><span><LuShieldCheck /> Approve before launch</span><span><LuGitBranch /> Isolated worktrees</span></div></div> : <TeamCanvas state={state} selected={selected} select={selectAgent} review={reviewPlan} />}
          {state.id && <div className="canvas-legend"><span><i /> Parent → worker</span><span><i className="dependency" /> Dependency</span><span><i className="skill-key" /> Skills</span><span>Drag team header to move</span></div>}
        </div>{selected && state.id && <Inspector state={state} selected={selected} close={() => setSelected('')} act={act} />}</div>
        {state.id && <div className="team-progress"><div><LuGitBranch /><code>{state.integrationBranch}</code><span>{integrated}/{state.workers.length} integrated</span></div><div className="team-progress-meter"><div className="progress-track"><i style={{ width: `${progress}%` }} /></div><span>{progress}%</span></div>{state.phase === 'review' && <button className="primary" onClick={reviewPlan}>Review plan <LuArrowRight /></button>}{['running', 'paused', 'complete'].includes(state.phase) && !state.pending.length && state.workers.length < 12 && <button onClick={() => act({ type: 'propose-addition' })}><LuPlus /> Propose worker</button>}{state.phase === 'complete' && <button className="primary" onClick={() => setModal('merge')}><LuGitMerge />{state.mainMerged ? 'View simulated merge' : 'Review merge into main'}</button>}</div>}
      </section>
      {showActivity && <section className="activity-panel" aria-label="Team activity"><header><strong><span className="live-dot" /> Team activity</strong><span>Simulated events · saved in this browser</span></header><div className="activity-list">{state.events.length ? state.events.map(event => <div className={`activity-event ${event.kind}`} key={event.id}><time>{event.time}</time>{event.kind === 'success' ? <LuCheck /> : event.kind === 'attention' ? <LuCircleAlert /> : <LuChevronRight />}<span>{event.text}</span></div>) : <p>Planning, approvals, worker results, and integration updates will appear here.</p>}</div></section>}
      <footer className="workspace-footer"><span><LuShieldCheck /> You approve the plan. The parent coordinates the work.</span><span>No CLI execution · No Git writes · No remote push</span></footer>
    </main>
    {modal === 'create' && <CreateTeam close={() => setModal(null)} create={config => { try { adapter.dispatch({ type: 'create', config }); setModal(null); setSelected('parent'); setError(''); } catch (cause) { setError(String(cause)); } }} />}
    {modal === 'plan' && state.phase === 'review' && <PlanReview state={state} act={act} close={() => setModal(null)} />}
    {modal === 'merge' && <MergeReview state={state} close={() => setModal(null)} act={act} />}
    {modal === 'standalone' && <Dialog title="Run a standalone agent" subtitle="The existing desktop Run agent workflow stays unchanged." close={() => setModal(null)}><div className="notice"><LuTerminal /><p>This browser prototype demonstrates Team Mode. Standalone runs remain available in the desktop app; no live agent can be started from this sandbox.</p></div><footer className="modal-footer"><button onClick={() => setModal(null)}>Back to canvas</button><button className="primary" onClick={() => setModal('create')}>Create a team instead <LuArrowRight /></button></footer></Dialog>}
    {newScenario && <Dialog title="Reset the prototype?" subtitle="This replaces the saved demo team in this browser." close={() => setNewScenario(null)}><p>Scenario: {scenarioLabels[newScenario]}. No real agents, files, or branches are affected.</p><footer className="modal-footer"><button onClick={() => setNewScenario(null)}>Keep this team</button><button className="primary" onClick={() => { reset(newScenario); setModal('create'); }}>Reset & create team</button></footer></Dialog>}
  </div>;
}
