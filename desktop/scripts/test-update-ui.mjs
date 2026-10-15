import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const route = "/__update-test";
const html = `<html><body style="margin:0"><div class="cg-shell" id="root"></div><script type="module">
import React from 'react'; import { createRoot } from 'react-dom/client';
import { createUpdateBridge } from '/src/update-bridge.ts';
import { UpdateBanner, UpdateCheckButton } from '/src/UpdateBanner.tsx'; import '/src/shell.css';
window.updateTest = { next: {state:'up-to-date',currentVersion:'0.2.0-beta.3',manual:true,supported:false}, calls:[], error:null, wait:false, openError:false };
window.contextgit = createUpdateBridge(async command => {
  const test = window.updateTest; test.calls.push(command);
  if (command === 'open_update_release') { if(test.openError) throw new Error('Could not open the default browser'); return; }
  if (test.wait) await new Promise(resolve => { test.release = resolve; });
  if (test.error) throw new Error(test.error);
  return test.next;
}, undefined, '0.2.0-beta.3');
createRoot(document.getElementById('root')).render(React.createElement(React.Fragment,null,React.createElement(UpdateBanner),React.createElement(UpdateCheckButton)));
</script></body></html>`;
const server = await createServer({ root, server: { host: "127.0.0.1", port: 0, strictPort: false }, plugins: [{ name: "update-ui-test", configureServer(server) {
  server.middlewares.use(route, async (_request, response) => { response.setHeader("Content-Type", "text/html"); response.end(await server.transformIndexHtml(route, html)); });
} }] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined, headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 500 } });
  await page.clock.install();
  await page.goto(`${server.resolvedUrls.local[0].replace(/\/$/, "")}${route}`);
  const update = page.getByRole("button", { name: "Update app", exact: true });
  await update.click();
  await page.getByText("You are up to date (0.2.0-beta.3).", { exact: true }).waitFor();
  await page.clock.runFor(6100);
  assert.equal(await page.locator(".cg-update-banner").count(), 0);
  await page.evaluate(() => { window.updateTest.wait = true; });
  await update.click();
  assert.equal(await page.getByRole("button", { name: "Checking…", exact: true }).isDisabled(), true);
  await page.getByText("Checking GitHub for updates…", { exact: true }).waitFor();
  await page.evaluate(() => { window.updateTest.wait = false; window.updateTest.next = {state:'available',currentVersion:'0.2.0-beta.3',version:'0.3.0',manual:true,supported:false,message:'Install this update manually.'}; window.updateTest.release(); });
  await page.getByText("Install this update manually.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.updateTest.calls.includes('open_update_release')), false, "checking must not launch a browser or installer automatically");
  await page.getByRole("button", { name: "Open release downloads" }).click();
  assert.equal(await page.evaluate(() => window.updateTest.calls.at(-1)), 'open_update_release');
  await page.getByRole("button", { name: "Later", exact: true }).click();
  await update.click();
  await page.getByText("Install this update manually.", { exact: true }).waitFor();
  await page.evaluate(() => { window.updateTest.openError = true; });
  await page.getByRole("button", { name: "Open release downloads" }).click();
  await page.getByText("Could not open the default browser", { exact: true }).waitFor();
  await page.evaluate(() => { window.updateTest.error = 'GitHub is offline'; });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByText("GitHub is offline", { exact: true }).waitFor();
  await page.evaluate(() => { window.updateTest.error = null; window.updateTest.next = {state:'up-to-date',currentVersion:'0.2.0-beta.3',manual:true,supported:false}; });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByText("You are up to date (0.2.0-beta.3).", { exact: true }).waitFor();
  await page.screenshot({ path: "/tmp/contextgit-update-ui.png" });
  assert.equal(await page.evaluate(() => window.updateTest.calls.includes('install_update')), false);
  console.log("Passed: checking/busy, up-to-date feedback, available, manual release opening, dismissal, failures and retry.");
} finally { await browser?.close(); await server.close(); }
