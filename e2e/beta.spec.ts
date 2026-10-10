import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";

let app: ElectronApplication;
let page: Page;
let directory: string;

const nav = (name: string) => page.locator(".cg-segmented").getByRole("tab", { name, exact: true });

test.beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "cg-beta-e2e-"));
  const project = path.join(directory, "project");
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, "README.md"), "# Beta fixture\n");
  app = await electron.launch({
    executablePath: path.resolve("desktop/node_modules/electron/dist/electron"),
    args: [path.resolve("desktop"), "--no-sandbox", `--user-data-dir=${path.join(directory, "profile")}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: "", CONTEXTGIT_PORT: "8762", CONTEXTGIT_WORKDIR: project },
  });
  page = await app.firstWindow();
  await expect(page.locator(".cg-shell")).toBeVisible({ timeout: 40_000 });
});

test.afterAll(async () => {
  await app?.close();
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
});

test("beta exposes terminal Code and Git only", async () => {
  await expect(page.locator(".cg-segmented").getByRole("tab")).toHaveCount(2);
  await expect(nav("Code")).toBeVisible();
  await expect(nav("Git")).toBeVisible();
  await expect(page.getByRole("button", { name: "Editor", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Why this code?", exact: true })).toHaveCount(0);
});

test("beta diagnostics report the runtime and agent availability", async () => {
  await nav("Code").click();
  await page.getByRole("button", { name: "Diagnostics", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Beta diagnostics" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Platform");
  await expect(dialog).toContainText("Shell");
  await expect(dialog).toContainText("Terminal agents");
  await dialog.getByRole("button", { name: "Close" }).click();
});
