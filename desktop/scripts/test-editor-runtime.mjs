import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const editorRoot = path.join(root, "build/editor");
const binary = process.env.CONTEXTGIT_CODE_SERVER ?? (existsSync(editorRoot) ? readdirSync(editorRoot).map(name => path.join(editorRoot, name, "bin", process.platform === "win32" ? "code-server.exe" : "code-server")).find(existsSync) : undefined);
assert.ok(binary, "Fetch the editor first or set CONTEXTGIT_CODE_SERVER.");
assert.ok(existsSync(binary), "Fetch the editor first or set CONTEXTGIT_CODE_SERVER.");
const temporary = mkdtempSync(path.join(tmpdir(), "contextgit-editor-runtime-"));
console.log(`Editor runtime diagnostics: ${temporary}`);
const project = path.join(temporary, "project");
const extension = path.join(temporary, "extensions/contextgit.contextgit-lifecycle-1.0.0");
let stateFile;
const restoreFile = path.join(temporary, "lifecycle.json.restore");
mkdirSync(project, { recursive: true }); mkdirSync(extension, { recursive: true });
writeFileSync(path.join(project, "main.ts"), "export const example = 1;\n");
for (const file of ["package.json", "extension.cjs"]) writeFileSync(path.join(extension, file), readFileSync(path.join(root, "src-tauri/editor-extension", file)));
const waitFor = async (predicate, description) => {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try { const result = predicate(); if (result) return result; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}`);
};
const readState = () => JSON.parse(readFileSync(stateFile, "utf8"));
let child, browser;
const stop = async () => {
  if (!child) return;
  const pid = child.pid;
  if (pid) {
    try { process.kill(process.platform === "win32" ? pid : -pid, "SIGTERM"); } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
    try { process.kill(process.platform === "win32" ? pid : -pid, "SIGKILL"); } catch {}
  }
  child = null;
};
const start = async instance => {
  stateFile = path.join(temporary, `lifecycle-${instance}.json`);
  let output = "";
  child = spawn(binary, ["--bind-addr", "127.0.0.1:0", "--auth", "none", "--disable-telemetry", "--disable-update-check", "--disable-workspace-trust", "--config", path.join(temporary, "config.yaml"), "--user-data-dir", path.join(temporary, "data"), "--extensions-dir", path.join(temporary, "extensions"), project], {
    detached: process.platform !== "win32", env: { ...process.env, PORT: "", CONTEXTGIT_EDITOR_INSTANCE: instance, CONTEXTGIT_EDITOR_STATE_FILE: stateFile, CONTEXTGIT_EDITOR_RESTORE_FILE: restoreFile }, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", data => { output += data; });
  child.stderr.on("data", data => { output += data; });
  child.on("error", error => { output += error.message; });
  try { return await waitFor(() => output.match(/HTTP server listening on (http:\/\/127\.0\.0\.1:\d+)\//)?.[1], "code-server listener"); }
  catch (error) { throw new Error(`${error.message}\n${output}`); }
};
try {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), headless: true });
  let started = performance.now();
  const url = await start("first");
  let page = await browser.newPage();
  await page.goto(`${url}/?folder=${encodeURIComponent(project)}`);
  await page.locator(".monaco-workbench").waitFor({ timeout: 45000 });
  const workbenchReadyMs = Math.round(performance.now() - started);
  await waitFor(() => { const state = readState(); return state.instanceId === "first" && !state.dirty; }, "integration extension activation");
  await page.keyboard.press("Control+p");
  await page.waitForSelector(".quick-input-widget input", { state: "visible" });
  await page.locator(".quick-input-widget input").fill(path.join(project, "main.ts"));
  await page.waitForTimeout(500);
  await page.keyboard.press("Enter");
  await page.waitForSelector(".editor .monaco-editor", { state: "visible" });
  await page.locator(".editor .monaco-editor .view-lines").first().click();
  await page.screenshot({ path: path.join(temporary, "editor-before-typing.png") });
  started = performance.now();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n// unsaved lifecycle test");
  await waitFor(() => readState().dirty, "dirty document report");
  const dirtyTransitionMs = Math.round(performance.now() - started);
  await page.keyboard.press("Control+s");
  await waitFor(() => !readState().dirty, "saved document report");
  assert.match(readFileSync(path.join(project, "main.ts"), "utf8"), /unsaved lifecycle test/);
  await waitFor(() => readState().active?.uri.endsWith("/main.ts"), "saved file layout");
  await page.close(); await stop();
  const next = await start("second");
  page = await browser.newPage();
  await page.goto(`${next}/?folder=${encodeURIComponent(project)}`);
  await waitFor(() => { const state = readState(); return state.instanceId === "second" && !state.dirty && state.active?.uri.endsWith("/main.ts"); }, "file layout restoration after restart");
  console.log(JSON.stringify({ result: "passed", workbenchReadyMs, dirtyTransitionMs, restoredFile: "main.ts", actualCodeServer: true, nativeWebKitMeasured: false, diagnosticDirectory: temporary }, null, 2));
} finally { await browser?.close(); await stop(); }
