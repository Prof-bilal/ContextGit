import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "../desktop/node_modules/esbuild";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";

let directory: string;
let app: ElectronApplication;
let page: Page;
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "cg-isolation-"));
  await build({
    entryPoints: [path.resolve("desktop/tests/feature-isolation.tsx")], outfile: path.join(directory, "renderer.js"),
    bundle: true, platform: "browser", format: "iife", jsx: "automatic", tsconfig: path.resolve("desktop/tsconfig.json")
  });
  fs.writeFileSync(path.join(directory, "index.html"), '<!doctype html><link rel="stylesheet" href="renderer.css"><div id="root"></div><script src="renderer.js"></script>');
  fs.writeFileSync(path.join(directory, "main.cjs"), 'const {app,BrowserWindow}=require("electron"); app.whenReady().then(()=>{ const win=new BrowserWindow({width:1400,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false}}); win.loadFile(__dirname+"/index.html"); });');
  app = await electron.launch({ executablePath: path.resolve("desktop/node_modules/electron/dist/electron"), args: [path.join(directory, "main.cjs"), "--no-sandbox"] });
  page = await app.firstWindow();
  await expect(page.getByLabel("git draft")).toBeVisible();
});
test.afterAll(async () => { await app?.close(); if (directory) fs.rmSync(directory, { recursive: true, force: true }); });
test.beforeEach(async () => {
  await page.reload();
  await expect(page.getByLabel("git draft")).toBeVisible();
});

for (const region of ["rail", "content", "inspector", "actions", "dialogs"]) {
  test(`${region} errors remain local and retry preserves feature state`, async () => {
    await page.getByLabel("git draft").fill("keep this draft");
    if (region === "dialogs") await page.getByRole("button", { name: "Open git dialog" }).click();
    await page.evaluate(region => window.isolation.fault({ id: "git", region }), region);
    const error = page.locator(`[data-failed-feature="git ${region}"]`);
    await expect(error).toBeVisible();
    await page.getByRole("tab", { name: "Code", exact: true }).click();
    await page.getByRole("button", { name: "terminal one: 0", exact: true }).click();
    await page.getByRole("tab", { name: "Git", exact: true }).click();
    // Active rails/inspectors/actions remount on tab changes; content and dialogs keep their boundary.
    await page.evaluate(() => window.isolation.fault(null));
    if (await error.count()) await error.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByLabel("git draft")).toHaveValue("keep this draft");
    if (region === "dialogs") await page.getByRole("button", { name: "Close git dialog" }).click();
    await page.getByRole("tab", { name: "Code", exact: true }).click();
    await expect(page.getByRole("button", { name: "terminal one: 1", exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.isolation.terminalMounts)).toBe(2);
  });
}

for (const region of ["hook", "background"]) {
  test(`a hidden Code ${region} failure keeps navigation and terminals alive`, async () => {
    await page.evaluate(region => window.isolation.fault({ id: "code", region }), region);
    await page.getByLabel("git draft").fill("unaffected Git");
    await page.getByRole("tab", { name: "Code", exact: true }).click();
    const error = page.locator('[data-failed-feature="Code"]');
    await expect(error).toBeVisible();
    await page.getByRole("button", { name: "terminal one: 0", exact: true }).click();
    await page.getByRole("button", { name: "terminal two: 0", exact: true }).click();
    await page.evaluate(() => window.isolation.fault(null));
    await error.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByLabel("code draft")).toBeVisible();
    await expect(page.getByRole("button", { name: "terminal one: 1", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "terminal two: 1", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Git", exact: true }).click();
    await expect(page.getByLabel("git draft")).toHaveValue("unaffected Git");
    expect(await page.evaluate(() => window.isolation.terminalMounts)).toBe(2);
  });
}

test("a shared hook failure retains cached reads, blocks stale actions, and retries independently", async () => {
  await expect(page.getByTestId("resource")).toHaveText("data: 7");
  await page.getByRole("button", { name: "Increment resource" }).click();
  await expect(page.getByTestId("resource")).toHaveText("data: 8");
  await page.evaluate(() => window.isolation.resourceCrash(true));
  const error = page.locator('[data-failed-feature="Test resource"]');
  await expect(error).toBeVisible();
  await expect(page.getByTestId("resource")).toHaveText("data: 8");
  await page.getByRole("button", { name: "Increment resource" }).click();
  await expect(page.getByText("resource unavailable", { exact: true })).toBeVisible();
  await page.getByLabel("git draft").fill("still usable");
  await page.evaluate(() => window.isolation.resourceCrash(false));
  await error.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("resource")).toHaveText("data: 7");
  await expect(page.getByLabel("git draft")).toHaveValue("still usable");
});

test("an event-handler rejection appears only in the owning feature", async () => {
  const unhandled: string[] = [];
  page.on("pageerror", error => unhandled.push(error.message));
  await page.getByRole("button", { name: "Fail git action" }).click();
  await expect(page.getByText("action failed locally", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Code", exact: true }).click();
  await expect(page.getByText("action failed locally", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("code draft")).toBeVisible();
  expect(unhandled).toEqual([]);
});

test("a failed dialog can be dismissed and releases native-view obscuring", async () => {
  await page.getByRole("button", { name: "Open git dialog" }).click();
  await page.evaluate(() => window.isolation.fault({ id: "git", region: "dialogs" }));
  await expect(page.getByTestId("overlay")).toHaveText("obscured");
  await page.getByRole("button", { name: "Close error" }).click();
  await expect(page.getByTestId("overlay")).toHaveText("visible");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => window.isolation.fault(null));
  await page.getByRole("button", { name: "Open git dialog" }).click();
  await expect(page.getByRole("dialog")).toContainText("git dialog");
});
