import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionRevision, uniqueSessions } from "../src/shell/terminal/sessionState";
import { validateBackend } from "../electron/backendHealth";
import { codexLimits, claudeUsage, jsonRecords, geminiCounters, aiderReport, statsTotals } from "../electron/usageParsers";
import { readCodex, UsageManager, SharedCodexUsage } from "../electron/usage";
import { rendererCsp } from "../shared/security";

test("a response that predates creation, deletion or an update is rejected", () => {
  for (const mutation of ["create", "delete", "update"]) {
    const revision = new SessionRevision();
    const before = revision.begin();
    revision.changed();
    assert.equal(revision.accepts(before), false, mutation);
    assert.equal(revision.accepts(revision.begin()), true);
  }
  const revision = new SessionRevision();
  const earlier = revision.begin(), later = revision.begin();
  assert.equal(revision.accepts(earlier), false);
  assert.equal(revision.accepts(later), true);
});

test("duplicate payloads preserve one newest session identity", () => {
  assert.deepEqual(uniqueSessions([{ id: "a", updated_at: "2026-10-08" }, { id: "b" }, { id: "a", updated_at: "2026-10-07" }]), [{ id: "a", updated_at: "2026-10-08" }, { id: "b" }]);
});

test("backend validation rejects unrelated servers, wrong repos and broken CORS", async () => {
  const fake = (scenario: string) => (async (url: string, init?: RequestInit) => {
    if (url.endsWith("health")) return Response.json({ service: scenario === "other" ? "other" : "contextgit", api_version: "1", status: "ok", repo_id: scenario === "repo" ? "other" : "expected", instance_id: "instance" });
    return Response.json(init?.method === "OPTIONS" ? {} : [], { headers: scenario === "cors" ? {} : { "access-control-allow-origin": "http://127.0.0.1:5173" } });
  }) as typeof fetch;
  for (const scenario of ["other", "repo", "cors"]) await assert.rejects(validateBackend("http://localhost", "expected", "http://127.0.0.1:5173", fake(scenario)));
  assert.deepEqual(await validateBackend("http://localhost", "expected", "http://127.0.0.1:5173", fake("ok")), { repoId: "expected", instanceId: "instance" });
});

test("backend readiness authenticates session checks and preflights both headers", async () => {
  const origin = "http://127.0.0.1:5173";
  const fake = (async (url: string, init?: RequestInit) => {
    if (url.endsWith("health")) return Response.json({ service: "contextgit", api_version: "1", status: "ok", repo_id: "expected", instance_id: "instance" });
    const headers = new Headers(init?.headers);
    if (init?.method === "OPTIONS") {
      assert.equal(headers.get("access-control-request-headers"), "content-type,authorization,x-contextgit-repo");
      return new Response(null, { headers: { "access-control-allow-origin": origin } });
    }
    assert.equal(headers.get("authorization"), "Bearer test-launch-token");
    assert.equal(headers.get("x-contextgit-repo"), "expected");
    return Response.json([], { headers: { "access-control-allow-origin": origin } });
  }) as typeof fetch;
  assert.equal((await validateBackend("http://localhost", "expected", origin, fake, "test-launch-token")).instanceId, "instance");
});

test("Codex maps returned buckets and actual durations without inventing token caps", () => {
  const limits = codexLimits({ rateLimitsByLimitId: {
    codex: { primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1791500000 }, secondary: { usedPercent: 91, windowDurationMins: 10080 } },
    other: { limitName: "Other pool", primary: { usedPercent: 1, windowDurationMins: 15 } },
  } }, { account: { type: "chatgpt", planType: "pro" } });
  assert.equal(limits.state, "available");
  assert.deepEqual(limits.windows.map(value => value.label), ["codex · 5-hour", "codex · Weekly", "Other pool · 15-minute"]);
  assert.equal(limits.windows[0].cap, 100);
  assert.equal(limits.windows[0].reset_at, new Date(1791500000 * 1000).toISOString());
  assert.equal(codexLimits({}, { account: { type: "apiKey" } }).state, "unsupported");
  assert.equal(codexLimits({}, { account: null }).state, "not_signed_in");
  assert.equal(codexLimits({ rateLimits: { primary: { usedPercent: NaN } } }, { account: { type: "chatgpt" } }).windows.length, 0);
});

test("Claude accepts independently absent quota windows and zero cost", () => {
  const result = claudeUsage({ rate_limits: { seven_day: { used_percentage: 41, resets_at: 1791500000 } }, cost: { total_cost_usd: 0 } });
  assert.equal(result.windows.length, 1);
  assert.equal(result.totals?.total_cost, 0);
  assert.deepEqual(claudeUsage({}), { windows: [], totals: null });
});

test("pretty JSON records survive split reads and quoted braces", () => {
  const first = jsonRecords('{\n"scopeMetrics": [], "text":"}\\"{"}\n{"a":');
  assert.equal(first.records.length, 1);
  assert.deepEqual(jsonRecords(first.remaining + '1}\n').records, [{ a: 1 }]);
});

test("Gemini cumulative counters replace prior exports instead of double counting", () => {
  const counters = new Map<string, number>();
  const payload = (value: number) => ({ scopeMetrics: [{ metrics: [{ descriptor: { name: "gemini_cli.token.usage" }, dataPoints: [{ attributes: { type: "input", model: "gemini" }, value }] }] }] });
  assert.equal(geminiCounters(payload(100), counters)?.total_tokens, 100);
  assert.equal(geminiCounters(payload(100), counters)?.total_tokens, 100);
  assert.equal(geminiCounters(payload(120), counters)?.total_tokens, 120);
});

test("local stats and Aider reports expose usage without quota percentages", () => {
  assert.equal(statsTotals("│ Total Cost $12.50 │\n│ Tokens 1.2M │")?.total_tokens, 1200000);
  assert.equal(statsTotals("unknown format"), null);
  assert.deepEqual(aiderReport("Tokens: 1.2k sent, 300 received. Cost: $0.01 message, $0.12 session."), { tokens: 1500, cost: .12 });
});

test("concurrent run observers stay isolated and completed readings survive", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cg-observers-"));
  const manager = new UsageManager(directory, directory);
  try {
    manager.prepare("pty-one", "one", "aider", directory);
    manager.prepare("pty-two", "two", "aider", directory);
    manager.observe("pty-one", "Tokens: 100 sent, 20 received. Cost: $0.01 message, $0.01 session.\n");
    manager.observe("pty-two", "Tokens: 500 sent, 50 received. Cost: $0.10 message, $0.10 session.\n");
    manager.finish("pty-one");
    assert.equal((await manager.read("aider", "one")).totals?.total_tokens, 120);
    assert.equal((await manager.read("aider", "two")).totals?.total_tokens, 550);
    assert.equal((await manager.read("pi", "old")).state, "waiting");
    const gemini = manager.prepare("pty-gemini", "g", "gemini", directory);
    assert.equal(gemini.env.GEMINI_TELEMETRY_LOG_PROMPTS, "false");
    assert.equal(gemini.env.GEMINI_TELEMETRY_TARGET, "local");
  } finally { manager.stop(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test("missing usage helpers or an unwritable sink never block CLI startup", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cg-usage-failure-"));
  const blocked = path.join(directory, "file");
  fs.writeFileSync(blocked, "not a directory");
  const missingHelper = new UsageManager(directory, directory);
  const unavailableSink = new UsageManager(blocked, directory);
  try {
    assert.deepEqual(missingHelper.prepare("one", "one", "claude", directory), { args: [], env: {} });
    assert.deepEqual(unavailableSink.prepare("two", "two", "gemini", directory), { args: [], env: {} });
    assert.equal((await unavailableSink.read("gemini", "two")).state, "error");
  } finally {
    missingHelper.stop(); unavailableSink.stop(); fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Codex helper reads account limits without starting an inference thread", { skip: process.platform === "win32" }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cg-codex-protocol-"));
  const command = path.join(directory, "codex");
  fs.writeFileSync(command, `#!/usr/bin/env node
process.stdin.setEncoding('utf8'); let pending='';
process.stdin.on('data', data => { pending+=data; let index; while((index=pending.indexOf('\\n'))>=0) {
const request=JSON.parse(pending.slice(0,index)); pending=pending.slice(index+1);
if (!['initialize','initialized','account/read','account/rateLimits/read'].includes(request.method)) process.exit(2);
if (request.id) process.stdout.write(JSON.stringify({id: request.id, result: request.id===2 ? {account:{type:'chatgpt'}} : request.id===3 ? {rateLimits:{primary:{usedPercent:22,windowDurationMins:300}}} : {}})+'\\n');
}});
`, { mode: 0o700 });
  try { assert.equal((await readCodex(command, process.env)).windows[0].used, 22); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("packaged CSP permits local resources and does not allow evaluated scripts", () => {
  const production = rendererCsp(false), development = rendererCsp(true);
  assert.ok(!production.includes("unsafe-eval"));
  assert.ok(!production.includes("script-src 'self' 'unsafe-inline'"));
  assert.ok(production.includes("http://127.0.0.1:*"));
  assert.ok(development.includes("ws://127.0.0.1:*"));
});

test("observer events use file observation time and ignore unchanged or partial records", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cg-live-usage-"));
  fs.writeFileSync(path.join(directory, "usage-pi.mjs"), "");
  const manager = new UsageManager(directory, directory);
  const updates: import("../../lib/api").HarnessLimits[] = [];
  const unsubscribe = manager.subscribe(value => updates.push(value));
  try {
    const launch = manager.prepare("pi-live", "session", "pi", directory);
    const file = launch.env.CONTEXTGIT_USAGE_FILE;
    fs.writeFileSync(file, JSON.stringify({ total_tokens: 123, total_cost: .02, requests: 1 }));
    const first = await manager.read("pi", "session");
    const count = updates.length;
    assert.equal(first.totals?.total_tokens, 123);
    assert.ok(first.launch_id);
    assert.equal(first.fetched_at, new Date(fs.statSync(file).mtimeMs).toISOString());
    assert.equal((await manager.read("pi", "session")).fetched_at, first.fetched_at);
    assert.equal(updates.length, count);
    fs.writeFileSync(file, '{"total_tokens":');
    assert.equal((await manager.read("pi", "session")).totals?.total_tokens, 123);
    fs.writeFileSync(file, JSON.stringify({ total_tokens: 456, total_cost: .03, requests: 2 }));
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(updates.at(-1)?.totals?.total_tokens, 456);
    assert.equal((await manager.read("pi", "other")).state, "waiting");
  } finally { unsubscribe(); manager.stop(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test("shared Codex connection publishes quota notifications and clears readings on auth changes", { skip: process.platform === "win32" }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cg-shared-codex-"));
  const command = path.join(directory, "codex");
  fs.writeFileSync(command, `#!/usr/bin/env node
process.stdin.setEncoding('utf8'); let pending='';
process.stdin.on('data', data => { pending+=data; let index; while((index=pending.indexOf('\\n'))>=0) {
const request=JSON.parse(pending.slice(0,index)); pending=pending.slice(index+1);
if (!['initialize','initialized','account/read','account/rateLimits/read'].includes(request.method)) process.exit(2);
const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
if (request.method==='initialize') send({id:request.id,result:{}});
if (request.method==='account/read') send({id:request.id,result:{account:{type:'chatgpt'}}});
if (request.method==='account/rateLimits/read') {
 send({id:request.id,result:{rateLimits:{primary:{usedPercent:22,windowDurationMins:300}}}});
 setTimeout(()=>send({method:'account/rateLimits/updated',params:{rateLimits:{primary:{usedPercent:35,windowDurationMins:300}}}}),25);
 setTimeout(()=>send({method:'account/updated',params:{}}),50);
}
}});
`, { mode: 0o700 });
  const updates: import("../../lib/api").HarnessLimits[] = [];
  const connection = new SharedCodexUsage(value => updates.push(value), command);
  try {
    assert.equal((await connection.read()).windows[0].used, 22);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(updates.some(value => value.windows[0]?.used === 35));
    assert.ok(updates.some(value => value.state === "waiting" && value.windows.length === 0));
  } finally { connection.stop(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test("session totals and account quotas keep independent keys and reject old launches", async () => {
  const { mergeUsageReadings, displayedUsageReadings } = await import("../shared/usage");
  const value: import("../../lib/api").HarnessLimits = {
    harness: "claude", label: "Claude Code", scope: "session", session_id: "selected", launch_id: "new",
    launch_started_at: "2026-10-08T10:00:00Z", fetched_at: "2026-10-08T10:05:00Z",
    state: "available", supported: true, signed_in: true, source: "status line", plan: null, credits: null, message: null,
    windows: [{ label: "5-hour", used: 30, cap: 100, unit: "%", reset_at: null }],
    totals: { total_tokens: 123, total_cost: .1, requests: null, period: "this launch" },
  };
  const readings = mergeUsageReadings([], value);
  assert.equal(readings.length, 2);
  assert.equal(readings[0].scope, "account");
  assert.equal(readings[0].session_id, undefined);
  assert.equal(readings[0].totals, null);
  assert.equal(readings[1].windows.length, 0);
  assert.equal(displayedUsageReadings(readings, "selected")[1].account_reading?.windows[0].used, 30);
  assert.equal(displayedUsageReadings(readings, "other").length, 1);
  assert.equal(mergeUsageReadings(readings, { ...value, launch_started_at: "2026-10-08T09:00:00Z" }), readings);
});
