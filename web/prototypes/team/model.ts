export type Phase = 'empty' | 'planning' | 'review' | 'running' | 'paused' | 'blocked' | 'complete';
export type Scenario = 'normal' | 'amendment' | 'missing-cli' | 'worker-failure' | 'merge-conflict' | 'check-failure';
export type Status = 'queued' | 'working' | 'reviewing' | 'failed' | 'accepted' | 'integrated';
export interface Skill { id: string; title: string; instruction: string; origin: 'built-in' | 'project' | 'global' }
export const SKILLS: Skill[] = [
  { id: 'design', title: 'UI design', instruction: 'Follow existing layout, spacing, and accessible interaction patterns.', origin: 'built-in' },
  { id: 'api', title: 'API design', instruction: 'Define typed contracts and validate inputs at the boundary.', origin: 'built-in' },
  { id: 'tests', title: 'Regression testing', instruction: 'Exercise success, failure, and recovery paths.', origin: 'built-in' },
  { id: 'project', title: 'Project conventions', instruction: 'Use the project service layer and existing component vocabulary.', origin: 'project' },
  { id: 'review', title: 'Evidence-led review', instruction: 'Inspect changes and require passing checks before accepting work.', origin: 'global' },
];
export const CLIS = ['codex', 'claude', 'gemini'];
export const INSTALLED = ['codex', 'claude'];
export interface Config { name: string; project: string; goal: string; parent: string; allowed: string[]; skills: Skill[]; concurrency: number }
export interface Worker {
  id: string; title: string; role: string; agent: string; reason: string; scope: string;
  dependencies: string[]; criteria: string; skills: Skill[]; status: Status; progress: number;
  log: string[]; reviews: string[]; commit?: string; baseCommit?: string;
}
export interface Event { id: number; time: string; text: string; kind: 'info' | 'success' | 'attention' }
export interface State {
  version: 1; id: string; config: Config; scenario: Scenario; phase: Phase; resumePhase: Phase;
  revision: number; planningStep: number; workers: Worker[]; pending: Worker[]; approved: boolean;
  integrationBranch: string; integrationHead: string; events: Event[]; faultUsed: boolean;
  amendmentOffered: boolean; blockedReason: string; mainMerged: boolean; sequence: number;
}
export const defaultConfig: Config = {
  name: 'Checkout experience', project: 'ContextGit',
  goal: 'Build a checkout flow with a typed API, accessible UI, and integration tests.',
  parent: 'codex', allowed: ['codex', 'claude'], skills: [SKILLS[3], SKILLS[4]], concurrency: 4,
};
export function initialState(scenario: Scenario = 'normal'): State {
  return { version: 1, id: '', config: structuredClone(defaultConfig), scenario, phase: 'empty', resumePhase: 'running',
    revision: 1, planningStep: 0, workers: [], pending: [], approved: false, integrationBranch: '',
    integrationHead: 'base-000', events: [], faultUsed: false, amendmentOffered: false,
    blockedReason: '', mainMerged: false, sequence: 0 };
}
function record(s: State, text: string, kind: Event['kind'] = 'info') {
  s.events.unshift({ id: ++s.sequence, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), text, kind });
  s.events = s.events.slice(0, 120);
}
export function makeWorker(index: number, config: Config): Worker {
  const specs = [
    ['Service contract', 'Backend developer', 'src/api/**', 'Define the typed service boundary before dependent UI work.', 'Typed endpoints handle valid and invalid requests.', SKILLS[1]],
    ['Checkout interface', 'Frontend developer', 'src/checkout/**', 'Give the interface one owner so behavior and visual details stay consistent.', 'Keyboard, loading, empty, and error states work.', SKILLS[0]],
    ['End-to-end validation', 'QA engineer', 'tests/checkout/**', 'Validate the integrated flow independently of its implementers.', 'The complete flow and failure paths pass.', SKILLS[2]],
    ['Documentation', 'Technical writer', 'docs/checkout/**', 'Document the final behavior and its operational limitations.', 'Setup and API examples match the implementation.', SKILLS[3]],
  ] as const;
  const spec = specs[index] ?? [`Follow-up ${index + 1}`, 'Specialist', `src/followup-${index + 1}/**`, 'Resolve a bounded follow-up with independent ownership.', 'The requested change passes its checks.', SKILLS[2]];
  return { id: `worker-${index + 1}`, title: spec[0], role: spec[1], scope: spec[2], reason: spec[3], criteria: spec[4],
    agent: config.allowed[index % Math.max(config.allowed.length, 1)] ?? 'codex', dependencies: index === 2 ? ['worker-1', 'worker-2'] : [],
    skills: structuredClone([...new Map([spec[5], ...config.skills].map(skill => [skill.id, skill])).values()]), status: 'queued', progress: 0, log: [], reviews: [] };
}
function scopesOverlap(a: string, b: string) {
  const x = a.replace(/\*.*$/, '').replace(/\/$/, '');
  const y = b.replace(/\*.*$/, '').replace(/\/$/, '');
  return x === y || x.startsWith(y + '/') || y.startsWith(x + '/') || !x || !y;
}
export function validatePlan(workers: Worker[], config: Config): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(config.concurrency) || config.concurrency < 1 || config.concurrency > 12) errors.push('Concurrency must be between 1 and 12.');
  if (!workers.length || workers.length > 12) errors.push('A team needs between 1 and 12 workers.');
  if (!INSTALLED.includes(config.parent)) errors.push(`Parent CLI ${config.parent} is not installed.`);
  const byId = new Map(workers.map(worker => [worker.id, worker]));
  if (byId.size !== workers.length) errors.push('Worker IDs must be unique.');
  for (const worker of workers) {
    if (!worker.title.trim() || !worker.role.trim() || !worker.criteria.trim() || !worker.scope.trim() || !worker.reason.trim()) errors.push(`${worker.id}: fill in task, role, reason, ownership, and completion criteria.`);
    if (!config.allowed.includes(worker.agent) || !INSTALLED.includes(worker.agent)) errors.push(`${worker.id}: ${worker.agent} is unavailable or not allowed.`);
    if (worker.dependencies.some(id => !byId.has(id))) errors.push(`${worker.id}: dependency does not exist.`);
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  function visit(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if (byId.get(id)?.dependencies.some(dep => byId.has(dep) && visit(dep))) return true;
    visiting.delete(id); visited.add(id); return false;
  }
  if (workers.some(worker => visit(worker.id))) errors.push('Dependencies contain a cycle.');
  for (let i = 0; i < workers.length; i++) for (let j = i + 1; j < workers.length; j++) {
    if (scopesOverlap(workers[i].scope, workers[j].scope)) errors.push(`${workers[i].id} and ${workers[j].id} have overlapping file ownership.`);
  }
  return [...new Set(errors)];
}
export type Action =
  | { type: 'create'; config: Config } | { type: 'tick' } | { type: 'approve' }
  | { type: 'edit'; id: string; patch: Partial<Worker> } | { type: 'remove'; id: string }
  | { type: 'add' } | { type: 'revise'; note: string } | { type: 'pause' } | { type: 'resume' }
  | { type: 'retry'; id: string } | { type: 'retry-integration' }
  | { type: 'propose-addition' } | { type: 'approve-addition' } | { type: 'reject-addition' }
  | { type: 'confirm-main' };
export function transition(previous: State, action: Action): State {
  const s = structuredClone(previous);
  switch (action.type) {
    case 'create': {
      if (!action.config.goal.trim() || !action.config.name.trim() || !action.config.allowed.length) throw new Error('Enter a team name, task, and at least one worker CLI.');
      if (!INSTALLED.includes(action.config.parent)) throw new Error('Choose an installed parent CLI.');
      if (!Number.isInteger(action.config.concurrency) || action.config.concurrency < 1 || action.config.concurrency > 12) throw new Error('Concurrency must be between 1 and 12.');
      const fresh = initialState(s.scenario);
      fresh.id = crypto.randomUUID().slice(0, 8); fresh.config = structuredClone(action.config);
      fresh.integrationBranch = `codex/team/${fresh.id}`; fresh.phase = 'planning';
      record(fresh, `${fresh.config.parent} parent created in its own simulated worktree.`);
      return fresh;
    }
    case 'tick': {
      if (s.phase === 'planning') {
        s.planningStep++;
        record(s, ['Inspecting project structure and existing conventions.', 'Identifying independent ownership and task dependencies.', 'Drafting worker assignments and validation criteria.'][s.planningStep - 1]);
        if (s.planningStep >= 3) {
          const count = /full|complex|platform|migration/i.test(s.config.goal) ? 4 : /test|api|backend|integration/i.test(s.config.goal) ? 3 : 2;
          s.workers = Array.from({ length: count }, (_, i) => makeWorker(i, s.config));
          if (s.scenario === 'missing-cli') s.workers[0].agent = 'gemini';
          s.phase = 'review'; record(s, `Plan revision ${s.revision}: ${count} workers proposed. Waiting for your approval.`, 'attention');
        }
        return s;
      }
      if (s.phase !== 'running' || !s.approved) return previous;
      // One integration per step models the server's serialized integration queue.
      const accepted = s.workers.find(worker => worker.status === 'accepted');
      if (accepted) {
        if (!s.faultUsed && ['merge-conflict', 'check-failure'].includes(s.scenario)) {
          s.faultUsed = true; s.phase = 'blocked';
          s.blockedReason = s.scenario === 'merge-conflict' ? 'Conflicting edits in the integration branch. All worktrees and commits are retained.' : 'Combined integration checks failed. The candidate commit is retained for correction.';
          record(s, s.blockedReason, 'attention'); return s;
        }
        accepted.status = 'integrated'; accepted.progress = 100;
        accepted.commit = `sim-${s.sequence.toString(16).padStart(6, '0')}`;
        s.integrationHead = accepted.commit;
        accepted.log.push(`Changes clean. Checks passed. Integrated ${accepted.commit} into ${s.integrationBranch}.`);
        record(s, `${accepted.title} integrated; combined validation passed.`, 'success');
      }
      for (const worker of s.workers.filter(worker => worker.status === 'reviewing')) {
        worker.status = 'accepted'; worker.reviews.push('Parent inspected the diff and passing checks. Accepted for integration.');
        worker.log.push('Parent review passed. Waiting for serialized integration.');
        record(s, `${worker.title}: parent accepted the result.`, 'success');
      }
      for (const worker of s.workers.filter(worker => worker.status === 'working')) {
        worker.progress += 34;
        worker.log.push(`Working in .worktrees/${s.id}/${worker.id} · progress ${Math.min(worker.progress, 100)}%`);
        if (!s.faultUsed && s.scenario === 'worker-failure' && worker.progress >= 68) {
          worker.status = 'failed'; s.faultUsed = true;
          worker.reviews.push('Parent requested changes: a regression check failed.');
          record(s, `${worker.title} needs correction. Its worktree is retained.`, 'attention');
        } else if (worker.progress >= 100) {
          worker.progress = 100; worker.status = 'reviewing';
          worker.log.push('Implementation complete. Submitted diff and checks to the parent.');
          record(s, `${worker.title} submitted for parent review.`);
        }
      }
      if (s.scenario === 'amendment' && !s.amendmentOffered && s.workers.some(w => w.status === 'integrated')) {
        s.amendmentOffered = true; s.pending = [makeWorker(s.workers.length, s.config)];
        record(s, 'Parent proposes a documentation worker. Approval is required before launch.', 'attention');
      }
      let active = s.workers.filter(worker => ['working', 'reviewing', 'accepted'].includes(worker.status)).length;
      for (const worker of s.workers) if (active < s.config.concurrency && worker.status === 'queued' && worker.dependencies.every(id => s.workers.some(dep => dep.id === id && dep.status === 'integrated'))) {
        worker.status = 'working'; worker.baseCommit = s.integrationHead;
        worker.log.push(`Started from integration commit ${worker.baseCommit}. Skill instructions snapshotted at approval.`);
        record(s, `${worker.title} started from ${worker.baseCommit}.`); active++;
      }
      if (s.workers.every(worker => worker.status === 'integrated') && !s.pending.length) {
        s.phase = 'complete'; record(s, 'All work reviewed and integrated. Combined checks passed. Ready for your merge review.', 'success');
      }
      return s;
    }
    case 'edit':
      if (s.phase !== 'review') return previous;
      s.workers = s.workers.map(w => w.id === action.id ? { ...w, ...action.patch, id: w.id, status: 'queued', progress: 0 } : w); return s;
    case 'remove':
      if (s.phase !== 'review') return previous;
      s.workers = s.workers.filter(w => w.id !== action.id).map(w => ({ ...w, dependencies: w.dependencies.filter(id => id !== action.id) })); return s;
    case 'add': {
      if (s.phase !== 'review' || s.workers.length >= 12) return previous;
      const index = Math.max(0, ...s.workers.map(w => Number(w.id.split('-')[1]))) ;
      s.workers.push(makeWorker(index, s.config)); return s;
    }
    case 'revise':
      if (s.phase !== 'review' || !action.note.trim()) return previous;
      s.revision++; record(s, `User requested revision: ${action.note}`);
      // A deterministic mock refinement; existing user edits remain intact.
      s.workers = s.workers.map(w => ({ ...w, reason: `${w.reason.split(' Revision request:')[0]} Revision request: ${action.note}` }));
      record(s, `Parent revised the plan to incorporate your feedback (revision ${s.revision}).`); return s;
    case 'approve': {
      if (s.phase !== 'review') return previous;
      const errors = validatePlan(s.workers, s.config); if (errors.length) throw new Error(errors.join(' '));
      s.approved = true; s.phase = 'running'; record(s, `You approved revision ${s.revision}. Worker launches authorized.`, 'success'); return s;
    }
    case 'pause':
      if (s.phase !== 'running') return previous;
      s.phase = 'paused'; record(s, 'Scheduling and integration paused. Active agent terminals remain open.'); return s;
    case 'resume':
      if (s.phase !== 'paused') return previous;
      s.phase = 'running'; record(s, 'Scheduling and integration resumed.'); return s;
    case 'retry': {
      const worker = s.workers.find(w => w.id === action.id);
      if (worker?.status !== 'failed') return previous;
      worker.status = 'queued'; worker.progress = 0; worker.log.push('Parent supplied corrective instructions. Retrying the same approved scope.');
      worker.reviews.push('Correction requested. Re-run the failing checks before resubmitting.');
      record(s, `${worker.title}: correction queued in the existing worktree.`); return s;
    }
    case 'retry-integration':
      if (s.phase !== 'blocked') return previous;
      s.phase = 'running'; s.blockedReason = ''; record(s, 'Simulated correction applied; integration will re-run all checks.'); return s;
    case 'propose-addition':
      if (!s.approved || s.pending.length || s.workers.length >= 12 || !['running', 'paused', 'complete'].includes(s.phase)) return previous;
      s.pending = [makeWorker(Math.max(...s.workers.map(w => Number(w.id.split('-')[1]))), s.config)];
      record(s, 'Parent requested an additional worker. Awaiting user approval.', 'attention'); return s;
    case 'approve-addition': {
      if (!s.pending.length) return previous;
      const errors = validatePlan([...s.workers, ...s.pending], s.config); if (errors.length) throw new Error(errors.join(' '));
      s.workers.push(...s.pending); s.pending = []; s.revision++;
      if (s.phase === 'complete') s.phase = 'running';
      record(s, 'You approved the added worker. Existing sessions and history are preserved.', 'success'); return s;
    }
    case 'reject-addition': s.pending = []; record(s, 'You declined the additional worker.'); return s;
    case 'confirm-main':
      if (s.phase !== 'complete' || s.mainMerged || s.pending.length) return previous;
      s.mainMerged = true; record(s, 'You confirmed the simulated merge into main. No real Git action was performed.', 'success'); return s;
  }
}

// Presentation components depend on this contract, not a real backend or CLI.
export interface TeamAdapter { getSnapshot: () => State; subscribe: (fn: () => void) => () => void; dispatch: (action: Action) => void; reset: (scenario: Scenario) => void }
export function createMockAdapter(storage?: Pick<Storage, 'getItem' | 'setItem'>): TeamAdapter {
  const key = 'contextgit:team-prototype:v1';
  let state = initialState();
  try { const saved = JSON.parse(storage?.getItem(key) ?? 'null'); if (saved?.version === 1 && Array.isArray(saved.workers) && Array.isArray(saved.events) && Array.isArray(saved.pending) && saved.config?.allowed) state = saved; } catch { /* A corrupt demo save starts fresh. */ }
  const listeners = new Set<() => void>();
  function publish(next: State) {
    state = next; try { storage?.setItem(key, JSON.stringify(state)); } catch { /* Storage may be disabled. */ }
    listeners.forEach(fn => fn());
  }
  return { getSnapshot: () => state, subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    dispatch: action => { const next = transition(state, action); if (next !== state) publish(next); },
    reset: scenario => publish(initialState(scenario)) };
}
