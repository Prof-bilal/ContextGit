import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

/**
 * Desktop e2e: launches the built Electron app (desktop/dist + desktop/dist-electron)
 * with its own backend on a private port and a throwaway repository.
 *
 * Run `npm run build --prefix desktop` first.
 */
let app: ElectronApplication;
let backendLogs = "";
let fixtureDirectory: string;
let testWorkdir: string;

/** A 1x1 PNG, seeded into the asset library so the gallery has an image to render. */
const SEED_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Top-nav tab (scoped: the composer's mode switch is also role=tab). */
const nav = (page: Page, name: string) => page.locator(".cg-segmented").getByRole("tab", { name });
/** Composer mode switch. */
const mode = (page: Page, name: string) => page.locator(".cg-modes").getByRole("tab", { name });

/**
 * First window with the shell mounted. Every test waits for the readiness gate
 * itself, so no test depends on a previous one having waited.
 */
async function openShell(): Promise<Page> {
  const page = await app.firstWindow();
  await expect(page.locator(".cg-shell")).toBeVisible({ timeout: 30_000 });
  return page;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const root = path.resolve(__dirname, "..");
  // Runs get real git worktrees, so the workspace must be a throwaway git repo
  // (not the ContextGit checkout itself).
  // Keep scanned fixtures outside a .contextgit worktree ancestor.
  fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "cg-desktop-e2e-"));
  const workdir = testWorkdir = path.join(fixtureDirectory, ".playwright-workdir");
  // The backend repo persists between runs; without clearing it, seeded commits
  // accumulate and every "seeded commit N" assertion matches duplicates.
  const contextgitRepo = path.join(root, ".playwright-contextgit-desktop");
  fs.rmSync(workdir, { recursive: true, force: true });
  fs.rmSync(contextgitRepo, { recursive: true, force: true });
  fs.mkdirSync(workdir, { recursive: true });
  const git = (...args: string[]) => spawnSync("git", args, { cwd: workdir });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "e2e@example.com");
  git("config", "user.name", "e2e");
  fs.writeFileSync(path.join(workdir, "README.md"), "# e2e project\n");
  // A route for the Endpoints tab to discover (parsed, never imported) and trace
  // back to its commit. Line 6 is the handler decorator.
  fs.writeFileSync(
    path.join(workdir, "app.py"),
    [
      "from fastapi import FastAPI",
      "",
      "app = FastAPI()",
      "",
      "",
      '@app.get("/health")',
      "def health() -> dict[str, str]:",
      '    return {"status": "ok"}',
      "",
    ].join("\n"),
  );
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  fs.writeFileSync(
    path.join(workdir, "app.py"),
    [
      "from fastapi import FastAPI",
      "",
      "app = FastAPI()",
      "",
      "",
      '@app.get("/health")',
      "def health() -> dict[str, str]:",
      '    return {"status": "ok"}',
      "",
      "",
      '@app.post("/notes")',
      "def add_note(text: str) -> dict[str, str]:",
      '    return {"text": text}',
      "",
    ].join("\n"),
  );
  git("add", "-A");
  git("commit", "-q", "-m", "add endpoints");

  // A private userData dir keeps the e2e out of the developer's real app data
  // (projects, theme, asset library). Seed the asset library so the Assets tab
  // has content to render without going through a native import dialog.
  const userData = path.join(root, ".playwright-userdata");
  fs.rmSync(userData, { recursive: true, force: true });
  const libraryFiles = path.join(userData, "assets", "files");
  fs.mkdirSync(libraryFiles, { recursive: true });
  const png = Buffer.from(SEED_PNG, "base64");
  fs.writeFileSync(path.join(libraryFiles, "seed-png.png"), png);
  fs.writeFileSync(path.join(libraryFiles, "seed-txt.txt"), "hello from e2e\n");
  fs.writeFileSync(
    path.join(userData, "assets", "assets.json"),
    `${JSON.stringify(
      [
        {
          id: "seed-png",
          name: "seeded.png",
          ext: ".png",
          kind: "image",
          mime: "image/png",
          size: png.length,
          added: 1,
          tags: ["seed"],
          note: "",
          source: "e2e",
        },
        {
          id: "seed-txt",
          name: "notes.txt",
          ext: ".txt",
          kind: "doc",
          mime: "text/plain",
          size: 16,
          added: 2,
          tags: [],
          note: "",
          source: "e2e",
        },
      ],
      null,
      2,
    )}\n`,
  );

  app = await electron.launch({
    executablePath: path.join(root, "desktop/node_modules/electron/dist/electron"),
    args: [path.join(root, "desktop"), "--no-sandbox", `--user-data-dir=${userData}`],
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("CTX_LLM_"))),
      VITE_DEV_SERVER_URL: "",
      CONTEXTGIT_REPO: contextgitRepo,
      CONTEXTGIT_PORT: "8757",
      CONTEXTGIT_WORKDIR: workdir,
    },
  });

  app.process().stderr?.on("data", (chunk: Buffer) => { backendLogs = (backendLogs + chunk.toString()).slice(-24000); });

  // The app's userData persists between runs (the Code tab remembers Single/Team,
  // the theme, …). Clear it so a failed run cannot change how the next one starts.
  const page = await app.firstWindow();
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.locator(".cg-shell").waitFor({ timeout: 30_000 });
});

test.afterAll(async () => {
  if (test.info().status !== test.info().expectedStatus) {
    await test.info().attach("desktop-backend-log", { body: backendLogs, contentType: "text/plain" });
  }
  await app?.close();
  if (fixtureDirectory) fs.rmSync(fixtureDirectory, { recursive: true, force: true });
});

test("workspace shell renders with the top nav", async () => {
  const page = await openShell();
  await page.waitForLoadState("domcontentloaded");

  await expect(page.locator(".backend-screen")).toHaveCount(0);
  await expect(page.locator(".cg-shell")).toBeVisible();
  await expect(nav(page, "Chat")).toBeVisible();
  await expect(nav(page, "Code")).toBeVisible();
  await expect(nav(page, "Agent")).toBeVisible();
  await expect(nav(page, "Git")).toBeVisible();
  await expect(nav(page, "Assets")).toBeVisible();
  await expect(page.locator(".cg-segmented").getByRole("tab")).toHaveCount(5);
  for (const retired of ["Browser", "Editor", "API", "Endpoints", "Why", "Database", "Playground", "Usage", "Storage"]) {
    await expect(nav(page, retired)).toHaveCount(0);
  }
});

test("legacy tab URLs redirect to the reduced navigation", async () => {
  const page = await openShell();
  const legacyUrl = new URL(await page.url());
  legacyUrl.searchParams.set("tab", "storage");
  await page.goto(legacyUrl.toString());
  await expect(nav(page, "Git")).toHaveAttribute("aria-selected", "true");
  expect(new URL(await page.url()).searchParams.get("tab")).toBe("git");

  legacyUrl.searchParams.set("tab", "playground");
  await page.goto(legacyUrl.toString());
  await expect(nav(page, "Agent")).toHaveAttribute("aria-selected", "true");
  expect(new URL(await page.url()).searchParams.get("tab")).toBe("agent");
});

test("the Assets tab renders the gallery and its controls", async () => {
  const page = await openShell();
  await nav(page, "Assets").click();

  await expect(page.locator('.cg-view[data-active="true"] .cg-view-toolbar h1')).toHaveText(
    "Assets",
  );
  await expect(page.getByRole("button", { name: "Import", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import folder" })).toBeVisible();
  // The type filters and search live in the rail.
  await expect(
    page.getByRole("tablist", { name: "Asset type" }).getByRole("tab", { name: /Images/ }),
  ).toBeVisible();
  await expect(page.getByLabel("Search assets")).toBeVisible();
});

test("the Assets gallery shows seeded assets and serves thumbnails", async () => {
  const page = await openShell();
  await nav(page, "Assets").click();

  const pngCard = page.locator(".cg-card", { hasText: "seeded.png" });
  await expect(pngCard).toBeVisible();
  await expect(page.locator(".cg-card", { hasText: "notes.txt" })).toBeVisible();

  // The image loads through the ctxasset:// scheme (main-process protocol).
  const naturalWidth = await pngCard
    .locator("img")
    .evaluate((img) => (img as HTMLImageElement).naturalWidth);
  expect(naturalWidth).toBeGreaterThan(0);

  // Selecting a card fills the inspector with its metadata + editable fields.
  await pngCard.click();
  await expect(page.locator(".cg-dock")).toContainText("image/png");
  await expect(page.locator("#cg-asset-name")).toHaveValue("seeded.png");
});

test("assets can be organised into folders", async () => {
  const page = await openShell();
  await nav(page, "Assets").click();

  // Create a folder from the rail.
  await page.getByRole("button", { name: "New folder" }).click();
  const dialog = page.getByRole("dialog", { name: "New folder" });
  await dialog.getByLabel("Folder name").fill("Logos");
  await dialog.getByRole("button", { name: "Create folder" }).click();
  const folderRow = page.locator(".cg-rail .cg-row", { hasText: "Logos" });
  await expect(folderRow).toBeVisible();

  // Move the seeded image into it via the inspector.
  await page.locator(".cg-card", { hasText: "seeded.png" }).click();
  await page.locator("#cg-asset-folder").selectOption("Logos");
  await page.locator(".cg-dock").getByRole("button", { name: "Save" }).click();

  // Filtering by the folder shows only its assets.
  await folderRow.click();
  await expect(page.locator(".cg-card", { hasText: "seeded.png" })).toBeVisible();
  await expect(page.locator(".cg-card", { hasText: "notes.txt" })).toHaveCount(0);
});

test("the asset agent uses the provider connector, isolated from Chat", async () => {
  const page = await openShell();
  await nav(page, "Assets").click();

  await page.getByRole("button", { name: "AI agent" }).click();
  const dialog = page.getByRole("dialog", { name: "Asset agent" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Provider")).toBeVisible();
  await expect(dialog.getByLabel("Model")).toBeVisible();

  // The agent's connector is the same proven modal, scoped to its own store.
  await dialog.getByRole("button", { name: "Connect provider…" }).click();
  const connector = page.getByRole("dialog", { name: "Connect the asset agent" });
  await expect(connector).toBeVisible();
  await expect(connector.getByLabel("Provider")).toBeVisible();
  await expect(connector.getByLabel("API key")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(connector).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("switch to the Git tab and toggle list/graph", async () => {
  const page = await openShell();

  await nav(page, "Git").click();
  await expect(page.locator(".cg-commit").first()).toBeVisible();

  await page.getByRole("tab", { name: "Graph" }).click();
  await expect(page.locator(".cg-graph .react-flow")).toBeVisible();
  await expect(page.locator(".cg-graph-node").first()).toBeVisible();

  await page.getByRole("tab", { name: "List" }).click();
  await expect(page.locator(".cg-commit").first()).toBeVisible();
});

test("the Git tab reads the real repository", async () => {
  const page = await openShell();

  // Seed real commits through the API.
  await page.evaluate(async () => {
    const base = window.contextgit!.apiBase;
    for (const n of [1, 2]) {
      await fetch(`${base}/api/v1/commits`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${window.contextgit!.apiToken}` },
        body: JSON.stringify({
          messages: [{ role: "user", content: `seeded turn ${n}` }],
          model: "e2e-model",
          summary: `seeded commit ${n}`,
        }),
      });
    }
  });

  await nav(page, "Git").click();
  await page.locator('.cg-view[data-active="true"] .cg-view-toolbar').getByRole("button", { name: "Refresh" }).click();

  await expect(page.locator(".cg-commit", { hasText: "seeded commit 2" })).toBeVisible();
  await expect(page.locator(".cg-commit", { hasText: "seeded commit 1" })).toBeVisible();
  // The fixtures are gone: no sample-data chip on the Git toolbar.
  await expect(page.locator('.cg-view[data-active="true"] .cg-view-toolbar')).not.toContainText(
    "sample data",
  );
});

test("View diff shows what a commit added", async () => {
  const page = await openShell();
  await nav(page, "Git").click();
  await page.locator(".cg-commit", { hasText: "seeded commit 2" }).click();
  await page.locator(".cg-dock").getByRole("button", { name: "View diff" }).click();

  const sheet = page.getByRole("dialog", { name: "Diff" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Added in this commit");
  await expect(sheet).toContainText("seeded turn 2");
  await expect(sheet).toContainText("tokens");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("branches with no commits are folded away", async () => {
  const page = await openShell();

  // A branch pointing at the root commit — exactly the state a repo lands in when
  // runs never commit.
  await page.evaluate(async () => {
    const base = window.contextgit!.apiBase;
    const snapshot = await fetch(`${base}/api/v1/repo`, { headers: { Authorization: `Bearer ${window.contextgit!.apiToken}` } }).then((r) => r.json());
    const root = snapshot.commits.find((commit: { parent_ids: string[] }) => commit.parent_ids.length === 0);
    if (root) {
      await fetch(`${base}/api/v1/branches`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${window.contextgit!.apiToken}` },
        body: JSON.stringify({ name: "e2e/empty", from_commit: root.id }),
      });
    }
  });

  await nav(page, "Git").click();
  await page.locator('.cg-view[data-active="true"] .cg-view-toolbar').getByRole("button", { name: "Refresh" }).click();

  const toggle = page.locator(".cg-rail").getByRole("button", { name: /with no commits/ });
  await expect(toggle).toBeVisible();
  expect(Number((await toggle.innerText()).match(/(\d+)/)?.[1] ?? 0)).toBeGreaterThan(0);

  // The empty branch is folded away until asked for. (The current branch is always
  // listed even when it has no commits of its own, so assert on this branch.)
  await expect(page.getByRole("button", { name: "Delete branch e2e/empty" })).toHaveCount(0);
  await toggle.click();
  await expect(page.locator(".cg-rail .cg-row", { hasText: "e2e/empty" })).toBeVisible();
});

test("a branch can be deleted, and the current one cannot", async () => {
  const page = await openShell();
  await nav(page, "Git").click();

  // A disposable branch pointing at the root commit.
  await page.evaluate(async () => {
    const base = window.contextgit!.apiBase;
    const snapshot = await fetch(`${base}/api/v1/repo`, { headers: { Authorization: `Bearer ${window.contextgit!.apiToken}` } }).then((r) => r.json());
    const root = snapshot.commits.find((commit: { parent_ids: string[] }) => commit.parent_ids.length === 0);
    if (root) {
      await fetch(`${base}/api/v1/branches`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${window.contextgit!.apiToken}` },
        body: JSON.stringify({ name: "e2e/to-delete", from_commit: root.id }),
      });
    }
  });
  await page.locator('.cg-view[data-active="true"] .cg-view-toolbar').getByRole("button", { name: "Refresh" }).click();

  // Empty branches are folded; open them only if they are currently folded.
  const toggle = page.locator(".cg-rail").getByRole("button", { name: /with no commits/ });
  if ((await toggle.innerText()).trimStart().startsWith("Show")) {
    await toggle.click();
  }

  const remove = page.getByRole("button", { name: "Move branch e2e/to-delete to Storage" });
  await expect(remove).toBeVisible();
  await remove.click();

  const dialog = page.getByRole("dialog", { name: "Move branch to Storage" });
  await expect(dialog).toContainText("e2e/to-delete");
  await expect(dialog).toContainText("Every commit stays");
  await dialog.getByRole("button", { name: "Move to Storage" }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Move branch e2e/to-delete to Storage" })).toHaveCount(0);

  // The current branch has no delete affordance at all.
  await expect(page.getByRole("button", { name: "Move branch main to Storage" })).toHaveCount(0);
});

test("Branch from here creates a real branch", async () => {
  const page = await openShell();
  await nav(page, "Git").click();

  const before = await page.locator(".cg-rail .cg-row").count();
  await page.locator(".cg-commit").first().click();
  await page.locator(".cg-dock").getByRole("button", { name: "Branch from here" }).click();

  const dialog = page.getByRole("dialog", { name: "Branch from here" });
  await expect(dialog).toBeVisible();
  await dialog.locator("#cg-branch-name").fill("e2e/branch-from-here");
  await dialog.getByRole("button", { name: "Create branch" }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".cg-rail .cg-row", { hasText: "e2e/branch-from-here" })).toBeVisible();
  expect(await page.locator(".cg-rail .cg-row").count()).toBe(before + 1);
});

test("clicking a branch in the rail moves the selection", async () => {
  const page = await openShell();
  await nav(page, "Git").click();

  // The branch created in the previous test.
  const target = page.locator(".cg-rail .cg-row", { hasText: "e2e/branch-from-here" });
  await expect(target).toBeVisible();
  await target.click();

  // Both the rail highlight and the toolbar must follow the clicked branch. When
  // every branch points at the same commit this used to silently do nothing.
  await expect(target).toHaveAttribute("aria-current", "true");
  await expect(page.locator('.cg-view[data-active="true"] .cg-view-toolbar')).toContainText(
    "e2e/branch-from-here",
  );

  // And going back to another branch moves it again.
  const main = page.locator(".cg-rail .cg-row", { hasText: "main" }).first();
  await main.click();
  await expect(main).toHaveAttribute("aria-current", "true");
});

test("the graph draws the real DAG and the merge dialog opens", async () => {
  const page = await openShell();
  await nav(page, "Git").click();

  await page.getByRole("tab", { name: "Graph" }).click();
  await expect(page.locator(".cg-graph .react-flow")).toBeVisible();
  expect(await page.locator(".cg-graph-node").count()).toBeGreaterThan(0);

  // Clicking a node selects that commit, and the inspector follows.
  await page.locator(".cg-graph-node").first().click();
  await expect(page.locator(".cg-dock")).toContainText("Commit");

  // Merge preview opens from the bottom bar (earlier tests created a second branch).
  await page.getByRole("button", { name: "Review merge…" }).click();
  const dialog = page.getByRole("dialog", { name: "Merge" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Merge from");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("start a run and get a live terminal pane", async () => {
  const page = await openShell();

  await nav(page, "Code").click();
  await page.getByRole("button", { name: "New run" }).click();
  await page.getByLabel("Run name").fill("e2e run");
  await page.getByLabel("Agent", { exact: true }).selectOption("shell");
  await page.getByRole("button", { name: "Start run" }).click();

  // The run shows up in the agent-grouped rail and its PTY connects.
  await expect(page.locator(".cg-row", { hasText: "e2e run" }).first()).toBeVisible();
  await expect(page.locator(".cg-term-host .xterm-screen").first()).toBeVisible();
});

test("the New run picker offers the auto-install harnesses", async () => {
  const page = await openShell();
  await nav(page, "Code").click();
  await page.getByRole("button", { name: "New run" }).click();

  const agent = page.getByLabel("Agent", { exact: true });
  for (const label of ["Freebuff", "Cline", "Pi", "Kilo Code", "Command Code"]) {
    await expect(agent.getByRole("option", { name: label, exact: true })).toHaveCount(1);
  }

  // Collapse the form so later tests start with the rail uncluttered.
  await page.getByRole("button", { name: "New run" }).click();
});

test("a run role auto-loads its five skills", async () => {
  const page = await openShell();
  await nav(page, "Code").click();
  await page.getByRole("button", { name: "New run" }).click();

  // Picking a role fills in exactly its five skills.
  const role = page.locator(".cg-form").getByLabel("Role");
  await role.selectOption("Frontend Developer");
  const skills = page.locator(".cg-role-skills li");
  await expect(skills).toHaveCount(5);
  await expect(page.locator(".cg-role-skills")).toContainText("UI research");
  await expect(page.locator(".cg-role-skills")).toContainText("Accessibility check");

  // Switching roles swaps the whole set.
  await role.selectOption("QA Engineer");
  await expect(skills).toHaveCount(5);
  await expect(page.locator(".cg-role-skills")).toContainText("Regression sweep");

  // Start it: the row carries a compact role chip, and the row still fits its
  // wrapper so the delete button is never clipped off the rail.
  await page.getByLabel("Run name").fill("role run");
  await page.getByLabel("Agent", { exact: true }).selectOption("shell");
  await page.getByRole("button", { name: "Start run" }).click();

  const row = page.locator(".cg-row-wrap", { hasText: "role run" });
  await expect(row.locator(".cg-role-chip")).toHaveText("QA");
  await expect(row.getByRole("button", { name: "Delete run role run" })).toBeVisible();
  expect(await row.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
});

test("the rail groups runs by project and the project menu opens", async () => {
  const page = await openShell();
  await nav(page, "Code").click();

  // CONTEXTGIT_WORKDIR pins the workspace; it shows as the single active project.
  const project = page.locator(".cg-project-group");
  await expect(project).toHaveCount(1);
  await expect(project.locator(".cg-group-name")).toContainText("playwright-workdir");
  await expect(page.locator('.cg-project-group[data-active="true"]')).toBeVisible();

  // A run nests under its project (an agent subgroup holds the rows).
  await expect(page.locator(".cg-project-group .cg-subgroup").first()).toBeVisible();
  await expect(page.locator(".cg-project-group .cg-row").first()).toBeVisible();

  // The header dropdown lists the project and closes on Escape.
  await page.locator(".cg-project-menu").click();
  const pop = page.locator(".cg-project-pop");
  await expect(pop).toBeVisible();
  await expect(pop.locator(".cg-project-pop-name")).toContainText("playwright-workdir");
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
});

test("the Code dock shows harness usage limits", async () => {
  const page = await openShell();
  await nav(page, "Code").click();

  await page.getByRole("button", { name: "New run" }).click();
  await page.getByLabel("Run name").fill("limits run");
  await page.getByLabel("Agent", { exact: true }).selectOption("shell");
  await page.getByRole("button", { name: "Start run" }).click();

  const row = page.locator(".cg-row", { hasText: "limits run" });
  await expect(row).toBeVisible();
  await row.click();

  // The Limits section renders for the selected run's harness (a message when
  // the CLI isn't signed in) — it must never be a broken panel.
  await expect(page.locator(".cg-limits")).toBeVisible();
});

test("choose the project folder from the Code tab", async () => {
  const page = await openShell();
  await nav(page, "Code").click();

  // CONTEXTGIT_WORKDIR pins the workspace to the throwaway e2e repo for this run.
  const trigger = page.locator(".cg-project-btn");
  await expect(trigger).toContainText(".playwright-workdir");
  await trigger.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Project folder");
  await expect(dialog.getByRole("button", { name: "Choose folder…" })).toBeVisible();

  // The "create a folder" flow shows a location and a name field without
  // opening a native dialog (which would block the test).
  await dialog.getByRole("button", { name: "New folder…" }).click();
  await expect(dialog.getByLabel("Folder name")).toBeVisible();
  await expect(dialog.getByLabel("Location")).toHaveValue(/.+/);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the fleet rail shows a run's changed files", async () => {
  const page = await openShell();
  await nav(page, "Code").click();

  const name = `fleet ${Date.now()}`;
  await page.getByRole("button", { name: "New run" }).click();
  await page.getByLabel("Run name").fill(name);
  await page.getByLabel("Agent", { exact: true }).selectOption("shell");
  await page.getByRole("button", { name: "Start run" }).click();

  // Wait for the run, then change a file in its own git worktree.
  await expect(page.locator(".cg-row", { hasText: name })).toBeVisible();
  const worktree = await page.evaluate(async (runName) => {
    const base = window.contextgit!.apiBase;
    const sessions = await fetch(`${base}/api/v1/sessions`, { headers: { Authorization: `Bearer ${window.contextgit!.apiToken}` } }).then((r) => r.json());
    const run = sessions.find((session: { name: string }) => session.name === runName);
    return (run?.worktree_path as string | undefined) ?? null;
  }, name);
  expect(worktree).toBeTruthy();
  fs.writeFileSync(path.join(String(worktree), "fleet.txt"), "changed\n");

  // The rail polls the fleet and shows the changed-file count.
  await expect(page.locator(".cg-row", { hasText: name })).toContainText("files", {
    timeout: 20_000,
  });
});

test("the New run form warns when a scope overlaps another run", async () => {
  const page = await openShell();
  await nav(page, "Code").click();

  // First run claims a directory.
  const first = `scope a ${Date.now()}`;
  await page.getByRole("button", { name: "New run" }).click();
  await page.getByLabel("Run name").fill(first);
  await page.getByLabel("Agent", { exact: true }).selectOption("shell");
  await page.getByLabel("Own files (optional)").fill("src/api/**");
  await page.getByRole("button", { name: "Start run" }).click();
  await expect(page.locator(".cg-row", { hasText: first })).toBeVisible();

  // A second run claiming a file inside it is warned live.
  await page.getByRole("button", { name: "New run" }).click();
  await page.getByLabel("Run name").fill("scope b");
  await page.getByLabel("Own files (optional)").fill("src/api/users.py");
  await expect(page.locator(".cg-form-warn")).toContainText("Overlaps", { timeout: 10_000 });

  // Collapse the form so later tests start with the rail uncluttered.
  await page.getByRole("button", { name: "New run" }).click();
});

test("a run can be queued and removed from the merge queue", async () => {
  const page = await openShell();
  await nav(page, "Code").click();

  const name = `queued ${Date.now()}`;
  await page.getByRole("button", { name: "New run" }).click();
  await page.getByLabel("Run name").fill(name);
  await page.getByLabel("Agent", { exact: true }).selectOption("shell");
  await page.getByRole("button", { name: "Start run" }).click();

  const row = page.locator(".cg-row", { hasText: name });
  await expect(row).toBeVisible();
  await row.click();

  const dock = page.locator(".cg-dock");
  await dock.getByRole("button", { name: "Queue this run" }).click();
  await expect(dock.locator(".cg-queue-name")).toContainText(name);

  await dock.getByRole("button", { name: "Remove from queue" }).click();
  await expect(dock.locator(".cg-queue-row")).toHaveCount(0);
});

test("a run's code and context integrate together", async () => {
  const page = await openShell();
  await nav(page, "Code").click();
  const workdir = testWorkdir;

  const name = `pair ${Date.now()}`;
  await page.getByRole("button", { name: "New run" }).click();
  await page.getByLabel("Run name").fill(name);
  await page.getByLabel("Agent", { exact: true }).selectOption("shell");
  await page.getByRole("button", { name: "Start run" }).click();

  const row = page.locator(".cg-row", { hasText: name });
  await expect(row).toBeVisible();
  await row.click();

  const run = await page.evaluate(async (runName) => {
    const base = window.contextgit!.apiBase;
    const sessions = await fetch(`${base}/api/v1/sessions`, { headers: { Authorization: `Bearer ${window.contextgit!.apiToken}` } }).then((r) => r.json());
    return sessions.find((session: { name: string }) => session.name === runName) as
      | { id: string; worktree_path: string }
      | undefined;
  }, name);
  expect(run?.worktree_path).toBeTruthy();
  const worktree = String(run?.worktree_path);

  // Give the run some context, and commit a code change in its worktree.
  await page.evaluate(async (sessionId) => {
    const base = window.contextgit!.apiBase;
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${window.contextgit!.apiToken}` };
    await fetch(`${base}/api/v1/sessions/${sessionId}/staging`, {
      method: "POST",
      headers,
      body: JSON.stringify({ messages: [{ role: "user", content: "decided X" }] }),
    });
    await fetch(`${base}/api/v1/sessions/${sessionId}/commit`, { method: "POST", headers, body: "{}" });
  }, String(run?.id));
  fs.writeFileSync(path.join(worktree, "paired.txt"), "p\n");
  spawnSync("git", ["-C", worktree, "add", "-A"]);
  spawnSync("git", [
    "-C",
    worktree,
    "-c",
    "user.email=e2e@example.com",
    "-c",
    "user.name=e2e",
    "commit",
    "-qm",
    "work",
  ]);

  const before = spawnSync("git", ["-C", workdir, "rev-parse", "main"]).stdout.toString().trim();
  await page.locator(".cg-dock").getByRole("button", { name: "Integrate code + context" }).click();

  await expect
    .poll(() => spawnSync("git", ["-C", workdir, "rev-parse", "main"]).stdout.toString().trim(), {
      timeout: 15_000,
    })
    .not.toBe(before);
  expect(spawnSync("git", ["-C", workdir, "show", "main:paired.txt"]).stdout.toString()).toBe("p\n");
});

test("Chat offers ten presets and selects a real registry model", async () => {
  const page = await openShell();
  await nav(page, "Chat").click();
  const connector = page.getByRole("dialog", { name: "Add a model provider" });
  await expect(connector).toBeVisible();
  const presets = connector.locator("#cg-provider-preset option");
  await expect(presets).toHaveCount(11); // Ten presets plus Custom.
  await expect(connector).toContainText("OmniRoute");
  await expect(connector).toContainText("Agnes");
  await connector.getByLabel("Close", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Send message" })).toBeDisabled();
  await page.getByRole("button", { name: "Continue offline (mock)" }).click();
  const trigger = page.locator(".cg-model-btn");
  await expect(trigger).toContainText("mock-1");
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Choose a model" });
  await expect(dialog).toContainText("OpenAI");
  await expect(dialog).toContainText("Claude");
  await dialog.getByLabel("Search providers and models").fill("mock-2");
  await dialog.getByRole("button", { name: "mock-2", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger.locator(".cg-model-btn-model")).toHaveText("mock-2");
  await expect(trigger.locator(".cg-model-btn-provider")).toHaveText("Mock (offline)");
});

test("chat send runs the mock thinking + streaming reply", async () => {
  const page = await openShell();
  await nav(page, "Chat").click();
  await mode(page, "Chat").click();

  const log = page.locator(".cg-chat-log");
  const before = await log.locator(".cg-msg").count();

  await page.locator("#cg-chat-prompt").fill("Which cache should I use?");
  await page.getByRole("button", { name: "Send message" }).click();

  // The user turn lands immediately and the thinking beat shows.
  await expect(log.getByText("Which cache should I use?")).toBeVisible();

  // Reply streams, then settles into a committed assistant message.
  await expect(page.locator(".cg-thinking")).toHaveCount(0, { timeout: 25_000 });
  await expect(log.getByText(/This is the offline mock provider/)).toBeVisible();
  await expect(log.locator(".cg-msg")).toHaveCount(before + 2);
});

test("a new conversation starts empty and can be deleted", async () => {
  const page = await openShell();
  await nav(page, "Chat").click();

  await page.getByRole("button", { name: "New conversation" }).click();
  const dialog = page.getByRole("dialog", { name: "New conversation" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Label (optional)").fill("e2e convo");
  await dialog.getByRole("button", { name: "Create conversation" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The new conversation is selected and, forked from the root, starts empty.
  const row = page.locator(".cg-row", { hasText: "e2e-convo" });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("aria-current", "true");
  await expect(page.locator(".cg-chat-log .cg-msg")).toHaveCount(0);

  // Code branches are not conversations: `main` (and any run or plain git
  // branch) holds chat turns only by inheritance, so it never gets a row here.
  const rail = page.getByRole("navigation", { name: "Conversations" });
  await expect(rail.locator(".cg-row", { hasText: "main" })).toHaveCount(0);
  await expect(rail.locator(".cg-row")).toHaveCount(1);

  // Delete it (with confirmation) — the row disappears.
  await page.getByRole("button", { name: /Move conversation chat\/e2e-convo to Storage/ }).click();
  const confirm = page.getByRole("dialog", { name: "Move conversation to Storage" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Move to Storage" }).click();
  await expect(page.locator(".cg-row", { hasText: "e2e-convo" })).toHaveCount(0);
});

test("council mode fans out to several models and keeps one answer", async () => {
  const page = await openShell();
  await nav(page, "Chat").click();
  await mode(page, "Council").click();

  await page.locator("#cg-chat-prompt").fill("Redis or in-process for the bucket?");
  await page.getByRole("button", { name: "Send message" }).click();

  const council = page.locator(".cg-council");
  await expect(council).toBeVisible();
  await expect(council.locator(".cg-council-col")).toHaveCount(2, { timeout: 25_000 });
  await expect(council.locator(".cg-council-text")).toHaveCount(2);

  await council.locator(".cg-council-col").first().getByRole("button", { name: "Keep this" }).click();
  await expect(council).toContainText("kept Mock (offline)");
});

test("research mode runs the steps and lands a cited report", async () => {
  const page = await openShell();
  await nav(page, "Chat").click();
  await mode(page, "Research").click();

  await page.locator("#cg-chat-prompt").fill("In-process vs Redis for a rate-limit bucket");
  await page.getByRole("button", { name: "Send message" }).click();

  const run = page.locator(".cg-research");
  await expect(run).toBeVisible();
  await expect(run.locator(".cg-steps li").first()).toBeVisible();
  await expect(run.locator(".cg-research-report")).toBeVisible({ timeout: 30_000 });
  await expect(run).toContainText("[1]");
});

test("image mode keeps a prompt history and renders tiles", async () => {
  const page = await openShell();
  await nav(page, "Chat").click();
  await mode(page, "Image").click();

  await page.locator("#cg-chat-prompt").fill("isometric token bucket, dark UI, orange accent");
  await page.getByRole("button", { name: "Generate image" }).click();

  const lab = page.locator(".cg-image");
  await expect(lab).toBeVisible();
  await expect(lab.locator(".cg-version")).toHaveCount(1);
  await expect(lab.locator(".cg-tile")).toHaveCount(4);

  // Editing the prompt and generating again keeps the previous version.
  await page.locator("#cg-chat-prompt").fill("…same, 35mm lens, soft key light from the left");
  await page.getByRole("button", { name: "Generate image" }).click();
  await expect(lab.locator(".cg-version")).toHaveCount(2);
  await expect(lab).toContainText("v2");
});

test("blame sheet shows cross-session provenance", async () => {
  const page = await openShell();
  await nav(page, "Chat").click();

  const first = page.locator(".cg-chat-log .cg-msg").first();
  await first.hover();
  await first.getByRole("button", { name: /blame/i }).click();

  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Where this came from");
  await expect(sheet).toContainText("Commit");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("governor displays real branch context and history", async () => {
  const page = await openShell();
  await nav(page, "Chat").click();
  const governor = page.locator(".cg-governor");
  await expect(governor).toContainText("Context governor");
  await expect(governor).toContainText("branch's real history");
  await expect(governor.locator(".cg-receipt").first()).toBeVisible();
  await expect(governor).not.toContainText("locked");
});

test("the Docs sub-tab in Chat has the creator", async () => {
  const page = await openShell();
  await nav(page, "Chat").click();

  // The Chat tab's own sub-tab (not the composer modes).
  await page.locator('.cg-view[data-active="true"] .cg-view-toolbar').getByRole("tab", { name: "Docs" }).click();
  await expect(page.locator(".cg-docs")).toBeVisible();

  const format = page.getByLabel("Document format");
  await expect(format).toBeVisible();
  await expect(format.locator("option")).toHaveCount(4);

  const style = page.getByLabel("Document style");
  await expect(style).toBeVisible();
  await expect(style.locator("option")).toHaveCount(3);
  await format.selectOption("md");
  await page.getByLabel("What should the document be about?").fill("Offline document test");
  await page.getByRole("button", { name: "Create document", exact: true }).click();
  await expect(page.locator(".cg-doc").getByRole("button", { name: "Download", exact: true })).toBeEnabled({ timeout: 15000 });
  await expect(page.locator(".cg-doclib-row")).toHaveCount(1);
  await expect(page.locator(".cg-doc .cg-pane-error")).toHaveCount(0);
  const artifact = await page.evaluate(async () => {
    const bridge = window.contextgit!;
    const headers = { Authorization: `Bearer ${bridge.apiToken}` };
    const docs = await (await fetch(`${bridge.apiBase}/api/v1/documents`, { headers })).json();
    const response = await fetch(`${bridge.apiBase}/api/v1/documents/${docs[0].id}?format=md`, { headers });
    return { status: response.status, text: await response.text() };
  });
  expect(artifact.status).toBe(200);
  expect(artifact.text).toContain("offline mock provider");
});

test("agent tab renders distinct clay avatars that react to state", async () => {
  const page = await openShell();
  await nav(page, "Agent").click();

  // 5 rail avatars + 1 hero
  await expect(page.locator(".cg-clay-wrap")).toHaveCount(6);

  // Every agent gets its own creature (no two variants collide).
  const variants = await page
    .locator(".cg-row .cg-clay-wrap")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-variant")));
  expect(new Set(variants).size).toBe(5);

  // The hero avatar follows the selected agent's state.
  const hero = page.locator(".cg-doc-head .cg-clay");
  await expect(hero).toHaveAttribute("data-state", "done");

  await page.locator(".cg-row", { hasText: "Belief Auditor" }).click();
  await expect(hero).toHaveAttribute("data-state", "paused");

  await page.locator(".cg-row", { hasText: "Drift Sentinel" }).click();
  await expect(hero).toHaveAttribute("data-state", "working");
});

test("clay avatars stop animating under reduced motion", async () => {
  const page = await openShell();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await nav(page, "Agent").click();

  const animation = await page
    .locator(".cg-doc-head .cg-clay")
    .evaluate((node) => getComputedStyle(node).animationName);
  expect(animation).toBe("none");

  await page.emulateMedia({ reducedMotion: null });
});

test("routine toggle and run-now drive the avatar state", async () => {
  const page = await openShell();
  await nav(page, "Agent").click();
  await page.locator(".cg-row", { hasText: "Context Curator" }).click();

  const hero = page.locator(".cg-doc-head .cg-clay");
  await expect(hero).toHaveAttribute("data-state", "done");

  // Pausing the routine visibly freezes the creature.
  await page.locator(".cg-routine input[type=checkbox]").click();
  await expect(hero).toHaveAttribute("data-state", "paused");
  await expect(page.getByRole("button", { name: "Run now" })).toBeDisabled();

  // Resume, then a run: working → done.
  await page.locator(".cg-routine input[type=checkbox]").click();
  await page.getByRole("button", { name: "Run now" }).click();
  await expect(hero).toHaveAttribute("data-state", "working");
  await expect(page.locator('.cg-run[data-live="true"]')).toBeVisible();
  await expect(hero).toHaveAttribute("data-state", "done", { timeout: 10_000 });
});

test("edit an agent's mission and keep it after switching away", async () => {
  const page = await openShell();
  await nav(page, "Agent").click();
  await page.locator(".cg-row", { hasText: "Context Curator" }).click();

  await page.getByRole("button", { name: "Edit agent" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("What is its purpose?");

  await dialog
    .locator("#cg-mission-text")
    .fill("Every night, compact context, pin what is referenced, and publish receipts. Never drop a dead end.");
  await dialog.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".cg-doc-title p")).toContainText("publish receipts");

  // The edit lives on the roster, so it survives switching agents and back.
  await page.locator(".cg-row", { hasText: "Flight Recorder" }).click();
  await page.locator(".cg-row", { hasText: "Context Curator" }).click();
  await expect(page.locator(".cg-doc-title p")).toContainText("publish receipts");
});

test("the inspector's Edit brief opens the same agent dialog", async () => {
  const page = await openShell();
  await nav(page, "Agent").click();

  await page.locator(".cg-dock").getByRole("button", { name: "Edit brief" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Edit agent");
  await expect(dialog.locator("#cg-mission-text")).not.toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("create a new agent with its own avatar", async () => {
  const page = await openShell();
  await nav(page, "Agent").click();

  const rowsBefore = await page.locator(".cg-row").count();
  const heroBefore = await page
    .locator(".cg-doc-head .cg-clay-wrap")
    .getAttribute("data-variant");

  await page.getByRole("button", { name: "New agent" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Shuffle re-rolls the creature (the avatar is seed-derived).
  const preview = dialog.locator(".cg-clay-wrap");
  const firstVariant = await preview.getAttribute("data-variant");
  await dialog.getByRole("button", { name: "Shuffle avatar" }).click();
  expect(await preview.getAttribute("data-variant")).not.toBe(firstVariant);

  await dialog.locator("#cg-agent-name").fill("Changelog Writer");
  await dialog
    .locator("#cg-mission-text")
    .fill("Every Friday, draft release notes from the commits merged to main.");
  await dialog.getByRole("button", { name: "Create agent" }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".cg-row")).toHaveCount(rowsBefore + 1);
  await expect(page.locator(".cg-doc-title h1")).toHaveText("Changelog Writer");
  await expect(page.locator(".cg-doc-title p")).toContainText("draft release notes");
  await expect(page.locator(".cg-doc-head .cg-clay-wrap")).not.toHaveAttribute(
    "data-variant",
    heroBefore ?? "",
  );

  // Every agent still has a distinct creature.
  const variants = await page
    .locator(".cg-row .cg-clay-wrap")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-variant")));
  expect(new Set(variants).size).toBe(rowsBefore + 1);
});

test("a recent run expands into its mock output", async () => {
  const page = await openShell();
  await nav(page, "Agent").click();
  await page.locator(".cg-row", { hasText: "Context Curator" }).click();

  const run = page.locator(".cg-run-btn").first();
  await expect(run).toHaveAttribute("aria-expanded", "false");
  await run.click();
  await expect(run).toHaveAttribute("aria-expanded", "true");

  const detail = page.locator(".cg-run-detail");
  await expect(detail).toBeVisible();
  await expect(detail.locator(".cg-runlog li")).toHaveCount(6);
  await expect(detail).toContainText("Checkpoint created");
  await expect(detail).toContainText("Done in");

  await run.click();
  await expect(page.locator(".cg-run-detail")).toHaveCount(0);
});

test("a run's View diff and Open run open real sheets", async () => {
  const page = await openShell();
  await nav(page, "Agent").click();
  await page.locator(".cg-row", { hasText: "Context Curator" }).click();
  await page.locator(".cg-run-btn").first().click();

  const detail = page.locator(".cg-run-detail");
  await expect(detail).toBeVisible();

  // View diff → what the run changed in the DAG
  await detail.getByRole("button", { name: "View diff" }).click();
  const diff = page.getByRole("dialog", { name: "Context diff" });
  await expect(diff).toBeVisible();
  await expect(diff.locator(".cg-diff li").first()).toBeVisible();
  await expect(diff).toContainText("added");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Open run → the full run with its artifacts
  await detail.getByRole("button", { name: "Open run" }).click();
  const runSheet = page.getByRole("dialog", { name: "Run" });
  await expect(runSheet).toBeVisible();
  await expect(runSheet.locator(".cg-runlog li")).toHaveCount(6);
  await expect(runSheet).toContainText("Artifacts");
  await runSheet.locator("footer").getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("shuffle keeps producing new designs", async () => {
  const page = await openShell();
  await nav(page, "Agent").click();
  await page.getByRole("button", { name: "New agent" }).click();

  const preview = page.getByRole("dialog").locator(".cg-clay-wrap");
  const seen = new Set<string>();
  for (let index = 0; index < 6; index += 1) {
    await page.getByRole("dialog").getByRole("button", { name: "Shuffle avatar" }).click();
    const variant = await preview.getAttribute("data-variant");
    if (variant) seen.add(variant);
  }
  expect(seen.size).toBeGreaterThanOrEqual(5);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("typing into a terminal reaches the PTY", async () => {
  const page = await openShell();

  await nav(page, "Code").click();
  await page.getByRole("button", { name: "New run" }).click();
  await page.getByLabel("Run name").fill("typed run");
  await page.getByLabel("Agent", { exact: true }).selectOption("shell");
  await page.getByRole("button", { name: "Start run" }).click();

  const pane = page.locator(".cg-pane", { hasText: "typed run" });
  await expect(pane).toBeVisible();

  // A fresh pane must not report a process exit, and keystrokes must land.
  await expect(page.locator(".cg-pane-exited")).toHaveCount(0);
  await pane.locator(".cg-term-host").click();
  await page.keyboard.type("echo CTX_TYPED_$((6*7))");
  await page.keyboard.press("Enter");
  // The WebGL renderer draws to a canvas; screenReaderMode exposes the text in
  // the accessibility DOM instead of .xterm-rows.
  await expect(pane.locator(".xterm-accessibility-tree")).toContainText("CTX_TYPED_42", {
    timeout: 15_000,
  });
});

test("team mode: a dependent task waits, then starts when its dependency is done", async () => {
  const page = await openShell();
  await nav(page, "Code").click();

  // The Code-mode switch (the pane-layout switch is also a mini segmented control).
  const modeSwitch = page.getByRole("tablist", { name: "Code mode" });

  // Switch the Code tab from Single to Team.
  await modeSwitch.getByRole("tab", { name: "Team" }).click();

  // A team is the mission every task hangs off.
  await expect(page.getByRole("heading", { name: "Start a team" })).toBeVisible();
  const teamName = `e2e team ${Date.now()}`;
  await page.getByLabel("Team name").fill(teamName);
  await page.getByRole("button", { name: "Create team" }).click();
  // Wait for the team to exist before seeding tasks into it.
  await expect(page.locator('.cg-view[data-active="true"] .cg-view-toolbar')).toContainText(teamName, { timeout: 10_000 });

  // Two tasks, the second depending on the first (seeded through the API, as
  // the other tests seed commits).
  const ids = await page.evaluate(async () => {
    const base = window.contextgit!.apiBase;
    const post = async (path: string, body: unknown) => {
      const response = await fetch(base + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${window.contextgit!.apiToken}` },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.text() };
    };
    const api = await post("/api/v1/team/tasks", {
      title: "e2e api",
      agent: "shell",
      role: "backend",
      // Unique to this test: team mode refuses a scope an existing run claims,
      // and the shared app already has runs claiming src/api/**.
      scope: ["team-e2e/api/**"],
      // A gate the test controls, so completion has a verdict to record.
      gate_command: "echo gate-ok",
    });
    if (api.status !== 201) throw new Error(`task api -> ${api.status} ${api.body}`);
    const web = await post("/api/v1/team/tasks", {
      title: "e2e web",
      agent: "shell",
      role: "frontend",
      scope: ["team-e2e/web/**"],
      depends_on: [JSON.parse(api.body).id],
    });
    if (web.status !== 201) throw new Error(`task web -> ${web.status} ${web.body}`);
    return { api: JSON.parse(api.body).id as string, web: JSON.parse(web.body).id as string };
  });

  const board = page.locator(".cg-board");
  // Match on the card's title text: the run's status icon (and the web card's
  // "waiting on …" line) both contribute text, so neither a prefix nor a plain
  // substring match is unambiguous once the runs exist.
  const apiCard = board
    .locator(".cg-board-card")
    .filter({ has: page.getByText("e2e api", { exact: true }) });
  const webCard = board
    .locator(".cg-board-card")
    .filter({ has: page.getByText("e2e web", { exact: true }) });
  await expect(apiCard).toBeVisible({ timeout: 10_000 });
  await expect(webCard).toContainText("waiting on e2e api");

  // Launch: only the ready task starts, and it gets a real terminal.
  await page.getByRole("button", { name: "Launch team" }).first().click();
  await expect(page.locator(".cg-pane", { hasText: "e2e api" })).toBeVisible({ timeout: 20_000 });
  await expect(webCard).toContainText("waiting on", { timeout: 10_000 });

  // Completing runs the gate; passing lands the task in review, not done.
  await page.evaluate(
    (id) => fetch(`${window.contextgit!.apiBase}/api/v1/team/tasks/${id}/complete`, { method: "POST", headers: { Authorization: `Bearer ${window.contextgit!.apiToken}` } }),
    ids.api,
  );
  await expect(apiCard).toContainText("gate pass", { timeout: 20_000 });
  await expect(webCard).toContainText("waiting on", { timeout: 10_000 });
  await expect(page.locator(".cg-pane", { hasText: "e2e web" })).toHaveCount(0);

  // The inspector carries the review verdict; approving starts the dependent.
  await apiCard.click();
  const dock = page.locator(".cg-dock");
  await expect(dock).toContainText("Independent review");
  await expect(dock.getByRole("button", { name: "View output" })).toBeEnabled();
  await dock.getByRole("button", { name: "Approve" }).click();
  await expect(page.locator(".cg-pane", { hasText: "e2e web" })).toBeVisible({ timeout: 20_000 });

  // The board file both agents read names both tasks.
  const workdir = testWorkdir;
  const boardFile = fs.readFileSync(path.join(workdir, ".contextgit", "team.md"), "utf8");
  expect(boardFile).toContain("e2e api");
  expect(boardFile).toContain("e2e web");
  expect(boardFile).toContain("### Done");

  // Leave the app on Single so nothing downstream inherits Team mode.
  await modeSwitch.getByRole("tab", { name: "Single" }).click();
  await expect(page.getByRole("button", { name: "New terminal" })).toBeVisible();
});

test("failed agent creation preserves the form and allows retry", async () => {
  const page = await openShell();
  await nav(page, "Code").click();
  await page.getByRole("button", { name: "New run", exact: true }).click();
  await page.getByLabel("Run name").fill("retry retained run");
  await page.getByLabel("Agent", { exact: true }).selectOption("shell");
  await page.route("**/api/v1/sessions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({ status: 409, json: { error: "Backend repository changed. Reopen the workspace to continue.", type: "RepositoryMismatch" } });
  });
  try {
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    await expect(page.getByText("Backend repository changed. Reopen the workspace to continue.", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Run name")).toHaveValue("retry retained run");
    await expect(page.getByRole("button", { name: "Start run", exact: true })).toBeEnabled();
  } finally { await page.unroute("**/api/v1/sessions"); }
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page.getByRole("region", { name: "retry retained run terminal", exact: true })).toBeVisible();
});

test("live CLI survives missing and duplicate polls, mode switches, and backend recovery", async () => {
  test.setTimeout(60000);
  const page = await openShell();
  const keyWarnings: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("Encountered two children with the same key")) keyWarnings.push(message.text());
  });
  await nav(page, "Code").click();
  const codeMode = page.getByRole("tablist", { name: "Code mode" });
  await codeMode.getByRole("tab", { name: "Single", exact: true }).click();
  await page.getByRole("button", { name: "New run", exact: true }).click();
  await page.getByLabel("Run name").fill("lifecycle survivor");
  await page.getByLabel("Agent", { exact: true }).selectOption("shell");
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  const pane = page.getByRole("region", { name: "lifecycle survivor terminal", exact: true });
  await expect(pane).toBeVisible();
  const output = pane.locator(".xterm-accessibility-tree");
  await expect(output).toContainText(/\S/, { timeout: 15000 });
  await pane.locator(".cg-term-host").click();
  await page.keyboard.type('CG_KEEP=survived; printf "CG_BEFORE=%s\\n" "$$"');
  await page.keyboard.press("Enter");
  await expect(output).toContainText(/CG_BEFORE=\d+/, { timeout: 15000 });
  const before = (await output.innerText()).match(/CG_BEFORE=(\d+)/)?.[1];
  expect(before).toBeTruthy();
  let polls = 0;
  await page.route("**/api/v1/sessions", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const sessions = await response.json();
    const omitted = sessions.filter((session: { name: string }) => session.name !== "lifecycle survivor");
    polls++;
    await route.fulfill({ response, json: [...omitted, ...omitted] });
  });
  try {
    await expect.poll(() => polls, { timeout: 15000 }).toBeGreaterThanOrEqual(2);
    await expect(pane).toHaveCount(1);
    await expect(pane.locator(".cg-pane-exited")).toHaveCount(0);
    // Duplicate payloads must not leave local controls or backend actions unusable.
    await pane.getByRole("button", { name: "Stage output", exact: true }).click();
    await expect(pane.locator(".cg-pane-staged")).toHaveText("1 staged");
    await page.getByRole("button", { name: "New run", exact: true }).click();
    await expect(page.getByLabel("Run name")).toBeVisible();
    await page.getByRole("button", { name: "New run", exact: true }).click();
    await nav(page, "Chat").click();
    await page.keyboard.press("Escape");
    await nav(page, "Code").click();
    await codeMode.getByRole("tab", { name: "Team", exact: true }).click();
    await codeMode.getByRole("tab", { name: "Single", exact: true }).click();
    const ready = await page.evaluate(() => window.contextgit!.getStatus().status);
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send("ctx:status", { state: "error", message: "TEST connection interrupted" });
    });
    await expect(page.getByText("TEST connection interrupted")).toBeVisible();
    await expect(page.getByRole("button", { name: "New terminal", exact: true })).toBeDisabled();
    await expect(pane).toHaveCount(1);
    await app.evaluate(({ BrowserWindow }, status) => {
      BrowserWindow.getAllWindows()[0].webContents.send("ctx:status", status);
    }, ready);
    await expect(page.getByRole("button", { name: "New terminal", exact: true })).toBeEnabled();
    await pane.locator(".cg-term-host").click();
    await page.keyboard.type('printf "CG_AFTER=%s CG_KEEP=%s\\n" "$$" "$CG_KEEP"');
    await page.keyboard.press("Enter");
    await expect(output).toContainText(`CG_AFTER=${before} CG_KEEP=survived`, { timeout: 15000 });
    expect(keyWarnings).toEqual([]);
  } finally { await page.unroute("**/api/v1/sessions"); }
});

test("a stalled create request releases the button and retains the run name", async () => {
  test.setTimeout(60000);
  const page = await openShell();
  await nav(page, "Code").click();
  await page.getByRole("tablist", { name: "Code mode" }).getByRole("tab", { name: "Single", exact: true }).click();
  await page.getByRole("button", { name: "New run", exact: true }).click();
  await page.getByLabel("Run name").fill("stalled create recovery");
  await page.getByLabel("Agent", { exact: true }).selectOption("shell");
  let intercepted: import("@playwright/test").Route | undefined;
  let submissions = 0;
  await page.route("**/api/v1/sessions", async route => {
    if (route.request().method() !== "POST") return route.continue();
    submissions++;
    intercepted = route; // Deliberately leave this request unanswered.
  });
  try {
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    await expect(page.getByRole("button", { name: "Starting…", exact: true })).toBeDisabled();
    await expect(page.getByText(/The backend took too long to respond/)).toBeVisible({ timeout: 35000 });
    await expect(page.getByRole("button", { name: "Start run", exact: true })).toBeEnabled();
    await expect(page.getByLabel("Run name")).toHaveValue("stalled create recovery");
    expect(submissions).toBe(1);
  } finally {
    await intercepted?.abort().catch(() => {});
    await page.unroute("**/api/v1/sessions");
  }
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page.getByRole("region", { name: "stalled create recovery terminal", exact: true })).toBeVisible();
});

test("concurrent backend reconnects preserve the live terminal and restore actions", async () => {
  test.setTimeout(60000);
  const page = await openShell();
  await nav(page, "Code").click();
  await page.getByRole("button", { name: "New run", exact: true }).click();
  await page.getByLabel("Run name").fill("real reconnect survivor");
  await page.getByLabel("Agent", { exact: true }).selectOption("shell");
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  const pane = page.getByRole("region", { name: "real reconnect survivor terminal", exact: true });
  await expect(pane).toBeVisible();
  await pane.locator(".cg-term-host").click();
  await page.keyboard.type('CG_RESTART_KEEP=alive; printf "CG_RESTART_BEFORE=%s\\n" "$$"');
  await page.keyboard.press("Enter");
  const output = pane.locator(".xterm-accessibility-tree");
  await expect(output).toContainText(/CG_RESTART_BEFORE=\d+/, { timeout: 15000 });
  const pid = (await output.innerText()).match(/CG_RESTART_BEFORE=(\d+)/)?.[1];
  expect(pid).toBeTruthy();
  const previous = await page.evaluate(() => window.contextgit!.getStatus().status);
  const statuses = await page.evaluate(async () => Promise.all([
    window.contextgit!.restartBackend(), window.contextgit!.restartBackend(),
  ]));
  for (const value of statuses) {
    expect(value.status.state).toBe("ready");
    expect(value.status).toEqual(statuses[0].status);
  }
  expect(statuses[0].status).not.toEqual(previous);
  await expect(pane).toHaveCount(1);
  await expect(pane.locator(".cg-pane-exited")).toHaveCount(0);
  await pane.locator(".cg-term-host").click();
  await page.keyboard.type('printf "CG_RESTART_AFTER=%s CG_RESTART_KEEP=%s\\n" "$$" "$CG_RESTART_KEEP"');
  await page.keyboard.press("Enter");
  await expect(output).toContainText(`CG_RESTART_AFTER=${pid} CG_RESTART_KEEP=alive`, { timeout: 15000 });
  await pane.getByRole("button", { name: "Stage output", exact: true }).click();
  await expect(pane.locator(".cg-pane-staged")).toHaveText("1 staged");
});

test("staging captures new output after scrollback fills and retains it after failure", async () => {
  test.setTimeout(60000);
  const page = await openShell();
  await nav(page, "Code").click();
  await page.getByRole("button", { name: "New run", exact: true }).click();
  await page.getByLabel("Run name").fill("scrollback stage survivor");
  await page.getByLabel("Agent", { exact: true }).selectOption("shell");
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  const pane = page.getByRole("region", { name: "scrollback stage survivor terminal", exact: true });
  const output = pane.locator(".xterm-accessibility-tree");
  await expect(output).toContainText(/\S/, { timeout: 15000 });
  await pane.getByRole("button", { name: "Stage output", exact: true }).click();
  await expect(pane.locator(".cg-pane-staged")).toHaveText("1 staged");
  await pane.locator(".cg-term-host").click();
  await page.keyboard.type('python3 -u -c "[print(\'CG_FILL_%05d\' % i) for i in range(15000)]; print(\'CG_FILL_DONE\', 15000)"');
  await page.keyboard.press("Enter");
  await expect(output).toContainText("CG_FILL_DONE 15000", { timeout: 20000 });
  await page.route("**/api/v1/sessions/*/staging", async route => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({ status: 503, json: { error: "TEST staging unavailable" } });
  });
  try {
    await pane.getByRole("button", { name: "Stage output", exact: true }).click();
    await expect(pane.getByText("TEST staging unavailable")).toBeVisible();
    await expect(pane.getByRole("button", { name: "Stage output", exact: true })).toBeEnabled();
    await expect(pane.locator(".cg-pane-staged")).toHaveText("1 staged");
  } finally { await page.unroute("**/api/v1/sessions/*/staging"); }
  await pane.getByRole("button", { name: "Stage output", exact: true }).click();
  await expect(pane.locator(".cg-pane-staged")).toHaveText("2 staged");
  const content = await page.evaluate(async () => {
    const bridge = window.contextgit!;
    const headers = { Authorization: `Bearer ${bridge.apiToken}` };
    const sessions = await (await fetch(`${bridge.apiBase}/api/v1/sessions`, { headers })).json();
    const session = sessions.find((value: { name: string }) => value.name === "scrollback stage survivor");
    const staged = await (await fetch(`${bridge.apiBase}/api/v1/sessions/${session.id}/staging`, { headers })).json();
    return staged.at(-1).content as string;
  });
  expect(content).toContain("CG_FILL_14999");
  expect(content).toContain("CG_FILL_DONE 15000");
});

// Opt in with: CONTEXTGIT_SOAK=1 npm run test:e2e -- --grep 'sustained terminal output'
test("30-minute sustained terminal output keeps buttons and backend actions usable", async () => {
  test.skip(process.env.CONTEXTGIT_SOAK !== "1", "Set CONTEXTGIT_SOAK=1 to run the 30-minute soak.");
  test.setTimeout(1860000);
  const page = await openShell();
  const errors: string[] = [];
  const onError = (error: Error) => errors.push(error.message);
  page.on("pageerror", onError);
  await nav(page, "Code").click();
  await page.getByRole("tablist", { name: "Code mode" }).getByRole("tab", { name: "Single", exact: true }).click();
  await page.getByRole("button", { name: "New run", exact: true }).click();
  await page.getByLabel("Run name").fill("sustained output soak");
  await page.getByLabel("Agent", { exact: true }).selectOption("shell");
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  const pane = page.getByRole("region", { name: "sustained output soak terminal", exact: true });
  await expect(pane).toBeVisible();
  await expect(pane.locator(".xterm-accessibility-tree")).toContainText(/\S/, { timeout: 15000 });
  await pane.locator(".cg-term-host").click();
  // An ordinary shell background job keeps emitting while the UI exercises actions.
  await page.keyboard.type('python3 -u -c "import time; [(print(\'CG_SOAK_%06d \' % i + \'x\'*1800, flush=True), time.sleep(0.05)) for i in range(37000)]" & CG_SOAK_PID=$!');
  await page.keyboard.press("Enter");
  await expect(pane.locator(".xterm-accessibility-tree")).toContainText(/CG_SOAK_\d{6}/, { timeout: 15000 });
  const started = Date.now();
  let checks = 0;
  try {
    while (Date.now() - started < 1800000) {
      await nav(page, "Chat").click();
      await page.keyboard.press("Escape");
      await nav(page, "Code").click();
      await page.getByRole("button", { name: "New run", exact: true }).click();
      await expect(page.getByLabel("Run name")).toBeVisible();
      await page.getByRole("button", { name: "New run", exact: true }).click();
      await pane.getByRole("button", { name: "Stage output", exact: true }).click();
      const expected = ++checks;
      await expect(pane.locator(".cg-pane-staged")).toHaveText(`${expected} staged`);
      await expect(pane.locator(".cg-pane-exited")).toHaveCount(0);
      expect(await page.evaluate(() => window.contextgit!.getStatus().status.state)).toBe("ready");
      expect(errors).toEqual([]);
      console.log(`SOAK ${Math.floor((Date.now() - started) / 1000)}s: ${checks} action checks passed`);
      await new Promise(resolve => setTimeout(resolve, Math.min(45000, Math.max(0, 1800000 - (Date.now() - started)))));
    }
  } finally {
    page.off("pageerror", onError);
    // A failed UI assertion must remain the reported error; app teardown kills the PTY.
    await nav(page, "Code").click({ timeout: 1000 }).catch(() => {});
    await pane.locator(".cg-term-host").click({ timeout: 1000 }).catch(() => {});
    await page.keyboard.type('kill "$CG_SOAK_PID"').catch(() => {});
    await page.keyboard.press("Enter").catch(() => {});
  }
});

test("Merge Agent authority, background progress, and conflict feedback", async () => {
  const page = await openShell();
  let settings = { project: testWorkdir, harness: "codex", target: "main", checks: "", authority: "disabled", generation: 0, branches: ["main"] };
  let jobState = "reviewing";
  await page.route("**/api/v1/integration/settings*", async route => {
    if (route.request().method() === "PUT") settings = { ...settings, ...route.request().postDataJSON() };
    await route.fulfill({ json: settings });
  });
  await page.route("**/api/v1/integration/jobs*", async route => {
    await route.fulfill({ json: [{ id: "fixture-job", session_id: "fixture-worker", source_sha: "a".repeat(40), target_sha: "b".repeat(40), state: jobState, attempts: 1, candidate_commit: null, conflicts: ["app.py"], feedback: jobState === "failed" ? "Resolution uncertain; return to worker" : "Reviewing candidate", resolution_diff: "", check_output: "", verdict: null, conversation_branch: "fixture-evidence", usage: null }] });
  });
  try {
    await nav(page, "Code").click();
    await page.getByRole("button", { name: "Merge Agent", exact: true }).click();
    const panel = page.getByRole("region", { name: "Merge Agent", exact: true });
    await expect(panel).toContainText("Authority: disabled");
    await expect(panel.getByRole("button", { name: "Enable automatic integration" })).toBeDisabled();
    await panel.getByLabel("Required integration checks").fill("npm test");
    await panel.getByRole("button", { name: "Enable automatic integration" }).click();
    await expect(panel).toContainText("Authority: enabled");
    await expect(panel).toContainText("Conflict files: app.py");
    await nav(page, "Assets").click();
    jobState = "failed";
    await nav(page, "Code").click();
    await expect(panel).toContainText("Resolution uncertain; return to worker");
    await panel.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(panel).toContainText("Authority: paused");
    await panel.getByRole("button", { name: "Revoke authority" }).click();
    await expect(panel).toContainText("Authority: disabled");
    await page.getByRole("button", { name: "Merge Agent", exact: true }).click();
  } finally {
    await page.unroute("**/api/v1/integration/settings*").catch(() => {});
    await page.unroute("**/api/v1/integration/jobs*").catch(() => {});
  }
});

test("Code usage changes from preload events without Refresh", async () => {
  const page = await openShell();
  await nav(page, "Code").click();
  await page.getByRole("button", { name: "New run" }).click();
  await page.getByLabel("Run name").fill("live usage fixture");
  await page.getByLabel("Agent", { exact: true }).selectOption("shell");
  await page.getByRole("button", { name: "Start run" }).click();
  await page.locator(".cg-row", { hasText: "live usage fixture" }).first().click();
  const session = await page.evaluate(async () => {
    const rows = await (await fetch(`${window.contextgit!.apiBase}/api/v1/sessions`, { headers: { Authorization: `Bearer ${window.contextgit!.apiToken}` } })).json();
    return rows.find((row: { name: string }) => row.name === "live usage fixture");
  });
  const value = { harness: "shell", label: "Shell", state: "available", scope: "session", session_id: session.id, signed_in: true, supported: true, source: "Fixture CLI event", plan: null, windows: [], credits: null, message: null, fetched_at: new Date().toISOString(), totals: { total_tokens: 123, total_cost: null, requests: null, period: "this launch" } };
  await app.evaluate(({ BrowserWindow }, reading) => BrowserWindow.getAllWindows()[0].webContents.send("ctx:usage-update", reading), value);
  await expect(page.locator(".cg-dock .cg-limits")).toContainText("123 tokens");
  await app.evaluate(({ BrowserWindow }, reading) => BrowserWindow.getAllWindows()[0].webContents.send("ctx:usage-update", reading), { ...value, totals: { ...value.totals, total_tokens: 456 } });
  await expect(page.locator(".cg-dock .cg-limits")).toContainText("456 tokens");
});
