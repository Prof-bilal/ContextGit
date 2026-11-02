// Browser QA uses the system Chromium and Node's built-in CDP/WebSocket support.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const origin = process.env.TEAM_PROTOTYPE_URL ?? 'http://127.0.0.1:5174';
const profile = await mkdtemp(join(tmpdir(), 'contextgit-team-qa-'));
const chrome = spawn(process.env.CHROMIUM_BIN ?? '/usr/bin/chromium', ['--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const endpoint = await new Promise((resolve, reject) => {
  let output = '';
  const timer = setTimeout(() => reject(new Error('Chromium did not start')), 15000);
  chrome.stderr.on('data', data => { output += data; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
  chrome.on('error', reject);
});
const socket = new WebSocket(endpoint);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject); });
let sequence = 0;
const pending = new Map(), errors = [];
socket.addEventListener('message', event => {
  const packet = JSON.parse(event.data);
  if (packet.id && pending.has(packet.id)) {
    const { resolve, reject, timer } = pending.get(packet.id); clearTimeout(timer); pending.delete(packet.id);
    if (packet.error) reject(new Error(JSON.stringify(packet.error))); else resolve(packet.result);
  }
  if (packet.method === 'Runtime.exceptionThrown') errors.push(packet.params.exceptionDetails.text);
});
function command(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 10000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
const cdp = (method, params) => command(method, params, sessionId);
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function wait(expression) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 80)); }
  throw new Error(`Timed out waiting for ${expression}`);
}
async function clickExpression(expression) {
  const bounds = await evaluate(`(() => { const el = ${expression}; if(!el) throw new Error('Element missing'); el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; if(!el.contains(document.elementFromPoint(x,y))) throw new Error('Clickable bounds obstructed'); return {x,y}; })()`);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...bounds });
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...bounds });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...bounds });
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
}
const button = text => clickExpression(`[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===${JSON.stringify(text)})`);
const state = () => evaluate(`JSON.parse(localStorage.getItem('contextgit:team-prototype:v1'))`);
async function ticks(count) { for (let i = 0; i < count; i++) { const s = await state(); if (!['planning', 'running'].includes(s.phase)) break; await button('Next step'); } }
async function screenshot(name) {
  await new Promise(resolve => setTimeout(resolve, 200));
  const { data } = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(tmpdir(), `contextgit-team-${name}.png`), Buffer.from(data, 'base64'));
}
async function create() {
  await button('Create your first team'); await wait(`!!document.querySelector('[role="dialog"]')`);
  await button('Create & plan'); await ticks(3);
  assert.equal((await state()).phase, 'review');
}
async function approve() { await button('Review plan'); await button('Approve and launch'); assert.equal((await state()).approved, true); }
async function resetScenario(value) {
  await evaluate(`(() => { const el = document.querySelector('[aria-label="Demo scenario"]'); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await wait(`!!document.querySelector('[aria-label="Reset the prototype?"]')`);
  await button('Reset & create team'); await button('Create & plan'); await ticks(3);
}
try {
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1120, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: origin });
  await wait(`!!document.querySelector('.empty-canvas')`);
  await clickExpression(`document.querySelector('.auto-toggle input')`);
  await screenshot('empty');
  await button('Create your first team');
  assert.ok(await evaluate(`document.activeElement.closest('[role="dialog"]') !== null`));
  await screenshot('create');
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await wait(`!document.querySelector('[role="dialog"]')`);
  await create();
  assert.ok((await state()).workers.every(worker => worker.status === 'queued'));
  await button('Review plan'); await screenshot('plan');
  assert.ok(await evaluate(`document.querySelector('[role="dialog"]').scrollHeight > document.querySelector('[role="dialog"]').clientHeight`));
  await button('Approve and launch'); await ticks(1);
  await screenshot('running');
  const groupBefore = await evaluate(`document.querySelector('.react-flow__node-boundary').style.transform`);
  const dragPoint = await evaluate(`(() => { const r=document.querySelector('.boundary-label').getBoundingClientRect(); return {x:r.x+65,y:r.y+r.height/2}; })()`);
  assert.ok(await evaluate(`document.elementFromPoint(${dragPoint.x},${dragPoint.y})?.closest('.boundary-label') !== null`), 'Team header receives pointer input');
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...dragPoint });
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...dragPoint });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dragPoint.x + 10, y: dragPoint.y + 6, buttons: 1 });
  await new Promise(resolve => setTimeout(resolve, 80));
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dragPoint.x + 30, y: dragPoint.y + 20, buttons: 1 });
  await new Promise(resolve => setTimeout(resolve, 80));
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: dragPoint.x + 30, y: dragPoint.y + 20 });
  await wait(`document.querySelector('.react-flow__node-boundary').style.transform !== ${JSON.stringify(groupBefore)}`);
  await button('Terminal');
  assert.ok(await evaluate(`document.querySelector('.terminal-output').textContent.includes('Worker launches authorized')`));
  await button('Overview');
  await button('Pause');
  assert.equal((await state()).phase, 'paused');
  assert.ok(await evaluate(`[...document.querySelectorAll('button')].find(el=>el.textContent.trim()==='Next step').disabled`));
  await button('Resume'); await ticks(35);
  assert.equal((await state()).phase, 'complete');
  await button('Review merge into main'); await screenshot('merge');
  await button('Confirm simulated merge'); assert.equal((await state()).mainMerged, true);
  const reloaded = new Promise(resolve => {
    const handler = event => { const packet = JSON.parse(event.data); if (packet.sessionId === sessionId && packet.method === 'Page.loadEventFired') { socket.removeEventListener('message', handler); resolve(); } };
    socket.addEventListener('message', handler);
  });
  await cdp('Page.reload'); await reloaded; await wait(`!!document.querySelector('[aria-label="Demo scenario"]') && document.body.textContent.includes('View simulated merge')`);
  assert.equal((await state()).mainMerged, true);
  await resetScenario('missing-cli');
  await button('Review plan');
  assert.ok(await evaluate(`[...document.querySelectorAll('button')].find(el=>el.textContent.trim()==='Approve and launch').disabled`));
  await evaluate(`(() => { const el=document.querySelector('.plan-worker select'); el.value='codex'; el.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await button('Approve and launch');
  await resetScenario('worker-failure'); await approve(); await ticks(10);
  const failed = (await state()).workers.find(w => w.status === 'failed'); assert.ok(failed);
  await clickExpression(`document.querySelector('[aria-label="Inspect ${failed.title}"]')`);
  await button('Request correction'); await ticks(35); assert.equal((await state()).phase, 'complete');
  await resetScenario('amendment'); await approve(); await ticks(8);
  assert.equal((await state()).pending.length, 1); await button('Approve worker'); await ticks(35);
  assert.equal((await state()).workers.length, 4); assert.equal((await state()).phase, 'complete');
  for (const scenario of ['merge-conflict', 'check-failure']) {
    await resetScenario(scenario); await approve(); await ticks(10);
    assert.equal((await state()).phase, 'blocked'); await button('Simulate fix & retry'); await ticks(35);
    assert.equal((await state()).phase, 'complete');
  }
  await resetScenario('normal'); await approve(); await ticks(1);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await screenshot('mobile');
  assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), 'No page-level horizontal overflow');
  await button('Propose worker'); await button('Decline');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 900, height: 1000, deviceScaleFactor: 1, mobile: false });
  await screenshot('tablet');
  assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth`));
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  console.log('PASS: desktop/mobile layout, real pointer hit areas, modal focus/Escape/scroll, plan approval, all scenarios, restart persistence, final merge confirmation.');
  console.log('Screenshots: /tmp/contextgit-team-{empty,create,plan,running,merge,mobile,tablet}.png');
} finally {
  await command('Browser.close').catch(() => {}); socket.close(); chrome.kill();
  await new Promise(resolve => setTimeout(resolve, 250));
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
