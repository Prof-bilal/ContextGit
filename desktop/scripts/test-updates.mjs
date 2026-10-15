import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/update-bridge.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
vm.runInNewContext(`(function(exports) { ${compiled} })`, { Error })(exports);
const status = (state, message) => ({ state, currentVersion: "0.2.0-beta.3", supported: false, manual: true, message });

test("update bridge shares checks, publishes results and preserves actual version", async () => {
  const calls = [], observed = [];
  let resolve;
  const result = new Promise(done => { resolve = done; });
  const bridge = exports.createUpdateBridge(command => { calls.push(command); return result; }, undefined, "0.2.0-beta.3");
  const unsubscribe = bridge.onUpdateStatus(next => observed.push(next.state));
  const first = bridge.checkForUpdates();
  const second = bridge.checkForUpdates();
  assert.equal(first, second);
  assert.deepEqual(calls, ["check_for_updates"]);
  assert.equal(bridge.getUpdateStatus().state, "checking");
  resolve(status("up-to-date"));
  await first;
  assert.deepEqual(observed, ["idle", "checking", "up-to-date"]);
  assert.equal(bridge.getUpdateStatus().currentVersion, "0.2.0-beta.3");
  unsubscribe();
});

test("native errors are visible and retries work", async () => {
  let attempts = 0;
  const bridge = exports.createUpdateBridge(async () => {
    if (++attempts === 1) throw new Error("GitHub rate limit");
    return status("available");
  }, undefined, "0.2.0-beta.3");
  assert.equal((await bridge.checkForUpdates()).message, "GitHub rate limit");
  assert.equal((await bridge.checkForUpdates()).state, "available");
});

test("native events and release-open failures reach both UI subscribers", async () => {
  let event;
  const bridge = exports.createUpdateBridge(async () => { throw new Error("No browser available"); }, async (_name, handler) => { event = handler; return () => {}; }, "0.2.0-beta.3");
  const values = [];
  bridge.onUpdateStatus(next => values.push(next.state));
  event({ payload: status("available") });
  await assert.rejects(bridge.openUpdateRelease(), /No browser/);
  assert.deepEqual(values, ["idle", "available", "error"]);
  assert.equal((await bridge.installUpdate()).state, "error");
});
