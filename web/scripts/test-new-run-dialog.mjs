import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const route = "/__new-run-test";
const html = `<html><body><div class="cg-shell" data-cg-theme="dark" id="root"></div><script type="module">
import React from 'react';
import { createRoot } from 'react-dom/client';
import NewRunDialog from '/src/shell/NewRunDialog.tsx';
import '/src/shell.css';
window.started = [];
createRoot(document.getElementById('root')).render(React.createElement(NewRunDialog, {
  onStart: async (...args) => { window.started.push(args); }, onClose: () => {}
}));
</script></body></html>`;
const server = await createServer({ root, server: { host: "127.0.0.1", port: 0, strictPort: false }, plugins: [{
  name: "new-run-test",
  configureServer(server) {
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
  const page = await browser.newPage({ viewport: { width: 600, height: 650 } });
  await page.goto(`${server.resolvedUrls.local[0].replace(/\/$/, "")}${route}`);
  await page.getByText("Advanced", { exact: true }).click();
  const worktree = page.getByRole("radio", { name: "Isolated worktree" });
  const project = page.getByRole("radio", { name: "Project root" });
  await worktree.waitFor({ state: "attached" });
  assert.equal(await worktree.isChecked(), true);
  await page.getByLabel("Run name").fill("UI test");
  await page.getByText("Project root", { exact: true }).click();
  assert.equal(await project.isChecked(), true);
  await page.getByRole("button", { name: "Start agent", exact: true }).click();
  assert.equal(await page.evaluate(() => window.started.at(-1)[4]), false);
  await project.focus();
  await page.keyboard.press("ArrowLeft");
  assert.equal(await worktree.isChecked(), true, "arrow keys change the selection");
  await page.getByRole("button", { name: "Start agent", exact: true }).click();
  assert.equal(await page.evaluate(() => window.started.at(-1)[4]), true);
  for (const theme of ["dark", "light"]) {
    await page.locator(".cg-shell").evaluate((element, value) => element.dataset.cgTheme = value, theme);
    await page.setViewportSize({ width: 360, height: 650 });
    assert.equal(await page.locator(".cg-run-location-tabs svg").count(), 2);
    assert.equal(await page.locator(".cg-run-location").evaluate(element => element.scrollWidth <= element.clientWidth), true);
    for (const selector of [".cg-modal", ".cg-btn", ".cg-new-agent-form input", ".cg-select-control select", ".cg-run-location-tabs", ".cg-run-location-tab span"]) {
      const radii = await page.locator(selector).evaluateAll(elements => elements.map(element => getComputedStyle(element).borderRadius));
      assert.ok(radii.every(radius => radius === "0px"), `${selector} must have square corners in ${theme} theme`);
    }
    await page.screenshot({ path: `/tmp/contextgit-new-run-${theme}.png` });
  }
  console.log("Passed: default, click, keyboard, submission, icons, narrow dark/light layouts, square corners.");
} finally { await browser?.close(); await server.close(); }
