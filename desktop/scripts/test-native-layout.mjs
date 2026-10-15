import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/shell/workspace/nativeLayout.ts", import.meta.url), "utf8");
const exports = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports });
const { NativeLayout } = exports;
const rect = width => ({ x: 0, y: 72, width, height: 700 });
const flush = () => new Promise(resolve => setImmediate(resolve));

test("unchanged rectangles produce one native IPC call", async () => {
  let calls = 0;
  const layout = new NativeLayout(async () => calls++, assert.fail);
  for (let i = 0; i < 100; i++) layout.update(rect(1200));
  await flush();
  assert.equal(calls, 1);
});

test("slow native IPC retains only the latest resize", async () => {
  let release;
  const calls = [];
  const layout = new NativeLayout(async bounds => {
    calls.push(bounds.width);
    if (calls.length === 1) await new Promise(resolve => { release = resolve; });
  }, assert.fail);
  layout.update(rect(100));
  for (let i = 101; i <= 200; i++) layout.update(rect(i));
  assert.deepEqual(calls, [100]);
  release(); await flush();
  assert.deepEqual(calls, [100, 200]);
});

test("disposing a hidden view drops pending work and late errors", async () => {
  let reject;
  let calls = 0;
  const layout = new NativeLayout(() => { calls++; return new Promise((_, fail) => { reject = fail; }); }, assert.fail);
  layout.update(rect(100)); layout.update(rect(200)); layout.dispose();
  reject(new Error("view closed")); await flush();
  layout.update(rect(300));
  assert.equal(calls, 1);
});
