import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const route = "/__knowledge-test";
const session = { id: "test-session", name: "Fix authentication", agent: "codex", category: "Authentication", scope: ["src/auth/**"], project_path: "/tmp/knowledge-ui", kind: "terminal", status: "idle", updated_at: "2026-10-16T00:00:00Z" };
const checkpoint = {
  id: "test-checkpoint", session_id: session.id, project_path: session.project_path, digest: "digest",
  name: session.name, category: session.category, scope: session.scope,
  markdown: "# Fix authentication\n\nThe authentication test failed.\n[REDACTED]",
  capture_status: "partial", warning: "Partial terminal recording; this is not a structured conversation.",
  redactions: 1, feedback: { rating: null, tags: [], note: "", category: session.category },
  artifact_path: null, updated_at: session.updated_at,
};
const lesson = {
  id: "lesson", session_id: session.id, checkpoint_id: checkpoint.id, project_path: session.project_path,
  category: session.category, scope: session.scope, title: "Validate authentication", status: "draft",
  instruction: "Run authentication tests before finishing.", rationale: "The earlier attempt failed.",
  evidence: "The authentication test failed.", confidence: "medium", conflicts: [], kind: "validation",
};
const html = `<html><body><div id="root" class="cg-shell" data-cg-theme="dark"></div><script type="module">
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import CheckpointDialog from '/src/shell/knowledge/CheckpointDialog.tsx';
import NewRunDialog from '/src/shell/NewRunDialog.tsx';
import ProjectHome from '/src/shell/knowledge/ProjectHome.tsx';
import {WorkbenchContext} from '/src/shell/WorkbenchContext.tsx';
import '/src/shell.css';
const session = ${JSON.stringify(session)};
window.contextgit = {apiBase: location.origin, apiToken: 'test', getStatus: () => ({apiBase: location.origin, status: {state: 'ready'}}), refreshBackendStatus: async () => ({apiBase: location.origin, status: {state: 'ready'}})};
window.finished = 0; window.cancelled = 0;
function App() {
  const [view, setView] = useState('checkpoint');
  window.showView = setView;
  return React.createElement(WorkbenchContext.Provider, {value: {
    workspace: {path: session.project_path, name: 'Example project'}, sessions: [session],
    openSession: () => { window.resumed = true; }, setCheckpointSession: () => setView('checkpoint')
  }}, view === 'checkpoint' ? React.createElement(CheckpointDialog, {session, closing: true,
    onCancel: () => {window.cancelled++; setView('home');}, onFinish: () => {window.finished++; setView('home');}
  }) : view === 'new' ? React.createElement(NewRunDialog, {projectPath: session.project_path,
    onStart: async (...args) => { window.started = args; }, onClose: () => setView('home')
  }) : React.createElement(ProjectHome, {onNew: () => setView('new')}));
}
createRoot(document.getElementById('root')).render(React.createElement(App));
</script></body></html>`;
const server = await createServer({ root, server: { host: "127.0.0.1", port: 0, strictPort: false }, plugins: [{
  name: "knowledge-test", configureServer(server) {
    server.middlewares.use(route, async (_request, response) => {
      response.setHeader("Content-Type", "text/html");
      response.end(await server.transformIndexHtml(route, html));
    });
  },
}] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined, headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const requests = [];
  let changed = true, failCapture = false, learned = null;
  let connectionSaved = false, connectionFails = true;
  const connectionProvider = { id: "openai", label: "OpenAI", base_url: "https://api.openai.com/v1", default_model: "example-model", configured: false, user_configured: false, has_key: false, requires_key: true, models: ["example-model"], kind: "cloud" };
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = request.postDataJSON();
    requests.push({ path, body });
    const send = (json, status = 200) => route.fulfill({ status, json });
    if (path.endsWith("/knowledge/provider-settings/test")) return connectionFails
      ? send({ detail: "Connection test failed. Check the API key." }, 409)
      : send({ status: "ready", message: "Connection tested successfully." });
    if (path.endsWith("/knowledge/provider-settings")) {
      if (request.method() === "PUT") {
        connectionSaved = true;
        Object.assign(connectionProvider, { configured: true, user_configured: true, has_key: true, default_model: body.model });
        return send(connectionProvider);
      }
      return send({ providers: [connectionProvider], default_provider: connectionSaved ? "openai" : null, app_default: false });
    }
    if (path.endsWith("/projects/open")) return send({ path: session.project_path, projectId: "project", repoId: "project" });
    if (path.endsWith("/checkpoint")) {
      if (failCapture) return send({ detail: "Capture temporarily unavailable" }, 409);
      return send({ status: "saved", changed, checkpoint });
    }
    if (path.endsWith("/feedback")) { checkpoint.feedback = body; return send(checkpoint); }
    if (path.endsWith("/checkpoint/export")) { checkpoint.markdown = body.markdown; checkpoint.artifact_path = ".contextgit/knowledge/conversations/checkpoint.md"; return send(checkpoint); }
    if (path.endsWith("/checkpoint/clean")) return send({ markdown: "# Reviewed summary\n\nAuthentication tests failed. Task unfinished." });
    if (path.endsWith("/learning-draft")) { learned = { ...lesson }; return send(learned); }
    if (path.endsWith("/approve")) { learned = { ...learned, status: "approved", instruction: body.instruction }; return send(learned); }
    if (path.endsWith("/knowledge/providers")) return send([]);
    if (path.endsWith("/knowledge/preflight")) return send({
      warnings: [{session_id: session.id, name: session.name, rating: 1, tags: ["incorrect"], note: "Tests failed"}],
      lessons: learned?.status === "approved" ? [learned] : [], suggested_categories: ["Authentication"],
    });
    if (path.endsWith("/knowledge")) return send({ checkpoints: [checkpoint], lessons: learned ? [learned] : [], categories: ["Authentication"] });
    return send({ detail: "Unexpected request" }, 404);
  });
  await page.goto(`${server.resolvedUrls.local[0].replace(/\/$/, "")}${route}`);
  await page.getByRole("dialog", { name: "Finish this conversation" }).waitFor();
  await page.getByLabel("Markdown preview").waitFor();
  assert.match(await page.getByRole("dialog").innerText(), /Partial terminal recording/);
  assert.match(await page.getByRole("dialog").innerText(), /1 obvious secret redacted/);
  assert.equal(await page.getByRole("button", { name: "Clean with AI" }).isDisabled(), true);
  await page.getByRole("button", { name: "Set up AI connection", exact: true }).click();
  await page.getByLabel("API key", { exact: true }).fill("ui-test-credential");
  assert.equal(await page.getByLabel("API key", { exact: true }).getAttribute("type"), "password");
  await page.getByRole("button", { name: "Test connection", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Connection test failed" }).waitFor();
  connectionFails = false;
  await page.getByRole("button", { name: "Test connection", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Connection tested successfully" }).waitFor();
  await page.getByRole("button", { name: "Save connection", exact: true }).click();
  await page.getByRole("button", { name: "Manage AI connection", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Clean with AI" }).isEnabled(), true);
  assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes("ui-test-credential")), false);
  await page.reload();
  await page.getByRole("button", { name: "Manage AI connection", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Clean with AI" }).isEnabled(), true);
  assert.match(await page.getByLabel("Learning provider").innerText(), /Project default/);
  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.getByLabel("incorrect", { exact: true }).check();
  await page.getByLabel("What should improve?").fill("Tests failed");
  await page.getByRole("button", { name: "Clean with AI" }).click();
  await page.waitForFunction(() => document.querySelector('.cg-markdown-preview')?.value.includes('Reviewed summary'));
  await page.getByRole("button", { name: "Generate learning draft" }).click();
  await page.getByLabel("Learning instruction").waitFor();
  assert.equal(requests.find(r => r.path.endsWith("/feedback")).body.rating, 1);
  assert.equal(requests.find(r => r.path.endsWith("/checkpoint/export")).body.markdown.includes("Reviewed summary"), true);
  assert.equal(requests.some(r => r.path.endsWith("/approve")), false);
  await page.getByLabel("Learning instruction").fill("Run focused authentication tests before finishing.");
  await page.getByRole("button", { name: "Approve for this project" }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Learning instruction"]')?.disabled === true);
  await page.screenshot({ path: "/tmp/contextgit-knowledge-review.png" });
  await page.getByRole("button", { name: "Close conversation", exact: true }).click();
  await page.getByRole("heading", { name: "Example project" }).waitFor();
  assert.equal(await page.evaluate(() => window.finished), 1);
  await page.getByRole("button", { name: "Resume conversation", exact: true }).click();
  assert.equal(await page.evaluate(() => window.resumed), true);
  await page.getByRole("button", { name: "Start new task" }).click();
  await page.getByLabel("Run name").fill("Fix authentication again");
  await page.getByLabel("Category", { exact: false }).fill("Authentication");
  await page.getByRole("complementary", { name: "Previous task guidance" }).waitFor();
  assert.match(await page.getByRole("complementary").innerText(), /1\/5/);
  assert.match(await page.getByRole("complementary").innerText(), /Approved:/);
  await page.getByRole("button", { name: "Start agent", exact: true }).click();
  assert.equal(await page.evaluate(() => window.started[5]), "Authentication");
  failCapture = true;
  await page.evaluate(() => window.showView("checkpoint"));
  await page.getByRole("alert").filter({ hasText: "Capture temporarily unavailable" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Close conversation", exact: true }).isDisabled(), true);
  failCapture = false;
  await page.getByRole("button", { name: "Retry capture" }).click();
  await page.getByLabel("Markdown preview").waitFor();
  await page.getByRole("button", { name: "Keep working" }).click();
  changed = false; checkpoint.warning = null;
  await page.evaluate(() => window.showView("checkpoint"));
  await page.waitForFunction(() => window.finished === 2);
  for (const theme of ["dark", "light"]) {
    await page.locator("#root").evaluate((el, theme) => { el.dataset.cgTheme = theme; }, theme);
    await page.setViewportSize({ width: 400, height: 820 });
    await page.screenshot({ path: `/tmp/contextgit-knowledge-home-${theme}.png` });
    assert.equal(await page.locator(".cg-project-home").evaluate(el => el.scrollWidth <= el.clientWidth), true);
  }
  assert.deepEqual(errors, []);
  console.log("Passed: checkpoint, partial capture, redaction preview, rating, AI cleaning, Markdown export, edited approval, history, resume, category preflight, recovery, unchanged close, narrow dark/light layouts.");
} finally { await browser?.close(); await server.close(); }
