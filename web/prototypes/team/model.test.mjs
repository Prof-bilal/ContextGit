import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockAdapter, defaultConfig, initialState, transition, validatePlan } from './model.ts';

function review(scenario = 'normal', config = defaultConfig) {
  let s = transition(initialState(scenario), { type: 'create', config });
  for (let i = 0; i < 3; i++) s = transition(s, { type: 'tick' });
  return s;
}
function tick(s, count = 1) {
  for (let i = 0; i < count; i++) s = transition(s, { type: 'tick' });
  return s;
}
test('planning never launches workers before approval; task controls worker count', () => {
  const s = review();
  assert.equal(s.phase, 'review');
  assert.ok(s.workers.every(w => w.status === 'queued'));
  assert.deepEqual(tick(s, 10), s);
  assert.equal(review('normal', { ...defaultConfig, goal: 'Write a small page' }).workers.length, 2);
  assert.equal(review('normal', { ...defaultConfig, goal: 'Build a full platform' }).workers.length, 4);
});
test('approval validation rejects missing CLIs, overlapping scopes, and missing completion criteria', () => {
  const s = review('missing-cli');
  assert.throws(() => transition(s, { type: 'approve' }), /unavailable/);
  s.workers[0].agent = 'codex';
  s.workers[1].scope = s.workers[0].scope;
  s.workers[1].criteria = '';
  assert.ok(validatePlan(s.workers, s.config).some(e => e.includes('overlapping')));
  assert.ok(validatePlan(s.workers, s.config).some(e => e.includes('completion')));
});
test('dependency cycles and unknown dependencies prevent approval', () => {
  const s = review();
  s.workers[0].dependencies = ['worker-2']; s.workers[1].dependencies = ['worker-1'];
  assert.throws(() => transition(s, { type: 'approve' }), /cycle/);
  s.workers[0].dependencies = ['missing']; s.workers[1].dependencies = [];
  assert.throws(() => transition(s, { type: 'approve' }), /does not exist/);
});
test('concurrency is bounded and dependency starts from integrated prerequisites', () => {
  let s = transition(review('normal', { ...defaultConfig, concurrency: 1 }), { type: 'approve' });
  s = tick(s);
  assert.equal(s.workers.filter(w => w.status === 'working').length, 1);
  for (let i = 0; i < 40; i++) {
    s = tick(s);
    assert.ok(s.workers.filter(w => ['working', 'reviewing', 'accepted'].includes(w.status)).length <= 1);
    const qa = s.workers[2];
    if (qa.baseCommit) {
      assert.ok(s.workers.slice(0, 2).every(w => w.status === 'integrated'));
      assert.equal(qa.baseCommit, s.workers[1].commit);
    }
  }
  assert.equal(s.phase, 'complete');
});
test('review and integration are distinct from terminal completion; integration is idempotent', () => {
  let s = transition(review(), { type: 'approve' });
  s = tick(s, 4);
  assert.equal(s.workers[0].status, 'reviewing');
  assert.equal(s.workers[0].commit, undefined);
  s = tick(s);
  assert.equal(s.workers[0].status, 'accepted');
  s = tick(s);
  assert.equal(s.workers[0].status, 'integrated');
  const commit = s.workers[0].commit;
  s = tick(s, 40);
  assert.equal(s.workers[0].commit, commit);
  const events = s.events.length;
  assert.deepEqual(tick(s, 5), s);
  assert.equal(s.events.length, events);
});
test('pause prevents scheduling and integration and resume preserves sessions', () => {
  let s = tick(transition(review(), { type: 'approve' }), 5);
  const ids = s.workers.map(w => w.id);
  s = transition(s, { type: 'pause' });
  assert.deepEqual(tick(s, 12), s);
  s = transition(s, { type: 'resume' });
  s = tick(s, 30);
  assert.equal(s.phase, 'complete'); assert.deepEqual(s.workers.map(w => w.id), ids);
});
test('worker correction preserves history and retries only the approved task', () => {
  let s = tick(transition(review('worker-failure'), { type: 'approve' }), 4);
  const failed = s.workers.find(w => w.status === 'failed');
  assert.ok(failed);
  const scope = failed.scope;
  s = transition(s, { type: 'retry', id: failed.id });
  s = tick(s, 35);
  assert.equal(s.phase, 'complete');
  assert.equal(s.workers.find(w => w.id === failed.id).scope, scope);
  assert.ok(s.workers.find(w => w.id === failed.id).reviews.length >= 3);
});
for (const scenario of ['merge-conflict', 'check-failure']) test(`${scenario} preserves accepted work and blocks integration until corrected`, () => {
  let s = tick(transition(review(scenario), { type: 'approve' }), 10);
  assert.equal(s.phase, 'blocked');
  assert.ok(s.workers.some(w => w.status === 'accepted'));
  assert.deepEqual(tick(s, 4), s);
  s = transition(s, { type: 'retry-integration' });
  s = tick(s, 30);
  assert.equal(s.phase, 'complete');
});
test('new worker requires approval, cannot replace existing graph, and keeps immutable skills', () => {
  let s = tick(transition(review('amendment'), { type: 'approve' }), 8);
  assert.equal(s.pending.length, 1);
  const before = structuredClone(s.workers);
  const count = before.length;
  assert.equal(s.pending[0].status, 'queued');
  s = transition(s, { type: 'approve-addition' });
  assert.equal(s.workers.length, count + 1);
  assert.deepEqual(s.workers.slice(0, count), before);
  const originalSkills = structuredClone(s.workers[0].skills);
  assert.deepEqual(transition(s, { type: 'edit', id: s.workers[0].id, patch: { scope: 'unsafe/**', skills: [] } }), s);
  s = tick(s, 40);
  assert.deepEqual(s.workers[0].skills, originalSkills);
  assert.equal(s.phase, 'complete');
});
test('declining an amendment launches no added worker', () => {
  let s = tick(transition(review('amendment'), { type: 'approve' }), 8);
  s = transition(s, { type: 'reject-addition' });
  s = tick(s, 30);
  assert.equal(s.phase, 'complete'); assert.equal(s.workers.length, 3);
});
test('only explicit final confirmation changes simulated main; repeated requests are harmless', () => {
  let s = transition(review(), { type: 'approve' });
  assert.deepEqual(transition(s, { type: 'confirm-main' }), s);
  s = tick(s, 35); assert.equal(s.mainMerged, false);
  s = transition(s, { type: 'confirm-main' }); assert.equal(s.mainMerged, true);
  assert.deepEqual(transition(s, { type: 'confirm-main' }), s);
});
test('persisted state restores without duplicate approval, launch, or integration', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const a = createMockAdapter(storage);
  a.dispatch({ type: 'create', config: defaultConfig });
  for (let i = 0; i < 3; i++) a.dispatch({ type: 'tick' });
  a.dispatch({ type: 'approve' });
  for (let i = 0; i < 8; i++) a.dispatch({ type: 'tick' });
  const b = createMockAdapter(storage);
  assert.deepEqual(b.getSnapshot(), a.getSnapshot());
  const integrated = b.getSnapshot().workers.filter(w => w.commit).map(w => [w.id, w.commit]);
  b.dispatch({ type: 'approve' });
  for (let i = 0; i < 35; i++) b.dispatch({ type: 'tick' });
  for (const [id, commit] of integrated) assert.equal(b.getSnapshot().workers.find(w => w.id === id).commit, commit);
  assert.equal(b.getSnapshot().phase, 'complete');
});
