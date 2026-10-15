import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

async function integration(previous, restorePath = "/state.restore") {
  const files = new Map(previous ? [[restorePath, JSON.stringify(previous)]] : []);
  const events = {};
  const timers = new Map();
  let nextTimer = 0, writes = 0;
  const event = name => handler => { events[name] = handler; return { dispose() {} }; };
  const vscode = {
    workspace: { textDocuments: [], notebookDocuments: [], onDidChangeTextDocument: event("text"), onDidSaveTextDocument: event("save"), onDidCloseTextDocument: event("close"), onDidChangeNotebookDocument: event("notebook") },
    window: { tabGroups: { all: [], onDidChangeTabs: event("tabs") }, onDidChangeActiveTextEditor: event("active"), onDidChangeTextEditorSelection: event("selection"), onDidChangeTextEditorVisibleRanges: event("scroll"), showTextDocument: async uri => { restored.push(uri); return { revealRange() {} }; } },
    TabInputText: class {}, Uri: { parse: value => value }, Position: class {}, Selection: class {}, Range: class {}, TextEditorRevealType: { AtTop: 1 },
  };
  const restored = [];
  const exports = {};
  const context = { subscriptions: [] };
  vm.runInNewContext(readFileSync(new URL("../src-tauri/editor-extension/extension.cjs", import.meta.url), "utf8"), {
    exports, process: { env: { CONTEXTGIT_EDITOR_STATE_FILE: "/state", CONTEXTGIT_EDITOR_INSTANCE: "instance", CONTEXTGIT_EDITOR_RESTORE_FILE: restorePath } },
    require: name => name === "vscode" ? vscode : {
      readFileSync(path) { if (!files.has(path)) throw new Error("Missing file"); return files.get(path); },
      writeFileSync(path, value) { writes++; files.set(path, value); },
      renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); },
    },
    setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout(id) { timers.delete(id); }, setInterval: () => 1, clearInterval() {},
  });
  await exports.activate(context);
  return { vscode, events, restored, state: () => JSON.parse(files.get("/state")), writes: () => writes, dispose: () => context.subscriptions.at(-1).dispose() };
}

test("dirty transitions are reported without writes on every keystroke", async () => {
  const app = await integration();
  assert.equal(app.state().dirty, false);
  app.vscode.workspace.textDocuments.push({ isDirty: true });
  app.events.text();
  assert.equal(app.state().dirty, true);
  const writes = app.writes();
  for (let i = 0; i < 100; i++) app.events.text();
  assert.equal(app.writes(), writes);
  app.vscode.workspace.textDocuments[0].isDirty = false;
  app.events.save();
  assert.equal(app.state().dirty, false);
  app.dispose();
  assert.equal(app.state().dirty, true, "a stopped reporter must never authorize cleanup");
});

test("notebooks and non-text dirty tabs also protect work", async () => {
  const app = await integration();
  app.vscode.workspace.notebookDocuments.push({ isDirty: true });
  app.events.notebook();
  assert.equal(app.state().dirty, true);
  app.vscode.workspace.notebookDocuments.length = 0;
  app.vscode.window.tabGroups.all.push({ tabs: [{ isDirty: true }] });
  app.events.tabs();
  assert.equal(app.state().dirty, true);
});

test("clean file layout restores after an idle restart", async () => {
  const app = await integration({ dirty: false, files: [{ uri: "file:///project/main.ts", column: 1 }], active: { uri: "file:///project/main.ts", line: 12, character: 4, top: 8 } });
  assert.deepEqual(app.restored, ["file:///project/main.ts", "file:///project/main.ts"]);
  assert.equal(app.state().instanceId, "instance");
  assert.equal(app.state().dirty, false);
});

test("instance-specific ledgers reuse the stable clean layout", async () => {
  const app = await integration({ dirty: false, files: [{ uri: "file:///project/retained.ts", column: 1 }] }, "/workspace/layout.restore");
  assert.deepEqual(app.restored, ["file:///project/retained.ts"]);
  assert.equal(app.state().instanceId, "instance");
  assert.equal(app.state().dirty, false);
});
