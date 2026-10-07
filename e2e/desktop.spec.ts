import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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
  const workdir = path.join(root, ".playwright-workdir");
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
      ...process.env,
      CONTEXTGIT_REPO: contextgitRepo,
      CONTEXTGIT_PORT: "8757",
      CONTEXTGIT_WORKDIR: workdir,
    },
  });

  // The app's userData persists between runs (the Code tab remembers Single/Team,
  // the theme, …). Clear it so a failed run cannot change how the next one starts.
  const page = await app.firstWindow();
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.locator(".cg-shell").waitFor({ timeout: 30_000 });
});

test.afterAll(async () => {
  await app.close();
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

test("the API tab sends a real request and saves it to a collection", async () => {
  const page = await openShell();
  await nav(page, "API").click();

  const base = await page.evaluate(
    () =>
      (window as unknown as { contextgit?: { apiBase?: string } }).contextgit?.apiBase ?? "",
  );
  expect(base).toBeTruthy();

  await expect(page.getByLabel("HTTP method")).toHaveValue("GET");
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();

  // A real round-trip to this app's own backend.
  await page.getByLabel("Request URL").fill(`${base}/api/v1/health`);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".cg-api-code")).toContainText("200");
  await expect(page.locator(".cg-api-pre")).toContainText("ok");

  // The request is recorded in the rail's history.
  await expect(page.locator(".cg-rail")).toContainText("/api/v1/health");

  // Saving stores the composed request as a file in the repo.
  await page.getByLabel("Collection name").fill("E2E API");
  await page.getByRole("button", { name: "Save request" }).click();
  const saved = page.locator(".cg-rail .cg-row", { hasText: "E2E API" });
  await expect(saved).toBeVisible();

  await page.getByRole("button", { name: "Delete collection E2E API" }).click();
  await expect(saved).toHaveCount(0);
});

test("the Endpoints tab lists the project's routes with their origin", async () => {
  const page = await openShell();
  await nav(page, "Endpoints").click();

  const row = page.locator(".cg-rail .cg-row", { hasText: "/health" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("GET");
  const notes = page.locator(".cg-rail .cg-row", { hasText: "/notes" });
  await expect(notes).toBeVisible();

  await row.click();
  await expect(page.locator(".cg-ep-path")).toHaveText("/health");
  // The handler location comes from the AST scan, not from a spec.
  await expect(page.locator(".cg-ep")).toContainText("app.py:6");
  // /health has not changed since the first commit, so that is its origin.
  await expect(page.locator(".cg-dock")).toContainText("init");

  // The endpoint added by the second commit is traced to that commit.
  await notes.click();
  await expect(page.locator(".cg-ep-path")).toHaveText("/notes");
  await expect(page.locator(".cg-dock")).toContainText("add endpoints");

  // The tab also owns the project's server: the detected command is offered in
  // an editable field, and starting it is always an explicit click.
  await expect(page.getByLabel("Run command")).toHaveValue(
    "python -m uvicorn app:app --host 127.0.0.1",
  );
  await expect(page.getByRole("button", { name: "Start server" })).toBeEnabled();
});

test("the Why tab reads a file's history and admits what it cannot know", async () => {
  const page = await openShell();
  await nav(page, "Why").click();

  await page.getByLabel("File path").fill("app.py");
  await page.getByRole("button", { name: "Explain" }).click();

  // The timeline comes from git, so it works without any provider.
  await expect(
    page.locator(".cg-rail .cg-row", { hasText: "add endpoints" }),
  ).toBeVisible();
  await expect(page.locator(".cg-rail .cg-row", { hasText: "init" })).toBeVisible();

  // The e2e project has no recorded runs, so we say that instead of inventing a why.
  await expect(page.locator(".cg-ep")).toContainText(
    "did not come from a recorded run",
  );
});

test("the DB tab connects to SQLite and runs a query", async () => {
  const page = await openShell();
  await nav(page, "Database").click();

  const dbPath = path.join(path.resolve(__dirname, ".."), ".playwright-workdir", "e2e.sqlite");
  fs.rmSync(dbPath, { force: true });

  await page.getByLabel("Engine").selectOption("sqlite");
  await page.getByLabel("Connection name").fill("E2E");
  await page.getByLabel("Database file").fill(dbPath);
  await page.getByRole("button", { name: "Connect" }).click();

  // SQLite needs no driver, so this really connects.
  await expect(page.locator(".cg-db-status")).toContainText("SQLite");

  await page.getByLabel("SQL").fill("SELECT 1 AS hello;");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator(".cg-db-table")).toContainText("hello");
  await expect(page.locator(".cg-db-results")).toContainText("1");

  // Saving keeps the connection (and never the password) for next time.
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".cg-rail .cg-row", { hasText: "E2E" })).toBeVisible();
});

test("the Browser tab opens real pages and refuses non-http schemes", async () => {
  const page = await openShell();
  await nav(page, "Browser").click();

  const browser = page.locator(".cg-browser");
  await expect(browser).toBeVisible();
  // A new tab shows the start page with shortcuts.
  await expect(browser.locator(".cg-browser-tile", { hasText: "Google" })).toBeVisible();

  // Loopback loads through the in-app view (the e2e backend).
  const status = page.locator(".cg-browser .cg-browser-status");
  const address = page.getByLabel("Address");
  await address.fill("http://127.0.0.1:8757/api/v1/health");
  await address.press("Enter");
  await expect(status).toHaveAttribute("data-status", "loaded", { timeout: 20_000 });

  // Non-http(s) schemes are refused.
  await address.fill("file:///etc/passwd");
  await address.press("Enter");
  await expect(status).toHaveAttribute("data-status", "blocked", { timeout: 10_000 });
});

test("the Editor tab starts the embedded VS Code sidecar", async () => {
  const page = await openShell();
  await nav(page, "Editor").click();
  await expect(page.locator(".cg-editor")).toBeVisible();

  // Start code-server from the view's start card.
  await page.locator(".cg-editor-start").getByRole("button", { name: "Start editor" }).click();
  await expect(page.locator(".cg-editor .cg-browser-status")).toHaveAttribute(
    "data-status",
    "loaded",
    { timeout: 60_000 },
  );

  // The rail reports the sidecar is running.
  await expect(page.locator(".cg-rail")).toContainText("Running on");

  // Our graph extension was installed under the name VS Code expects, and scanned.
  const root = path.resolve(__dirname, "..");
  const extensionsDir = path.join(root, ".playwright-userdata", "editor", "extensions");
  expect(
    fs.existsSync(path.join(extensionsDir, "contextgit.contextgraph-0.1.0", "extension.js")),
  ).toBe(true);
  expect(fs.existsSync(path.join(extensionsDir, ".obsolete"))).toBe(false);
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: `seeded turn ${n}` }],
          model: "e2e-model",
          summary: `seeded commit ${n}`,
        }),
      });
    }
  });

  await nav(page, "Git").click();
  await page.locator(".cg-view-toolbar").getByRole("button", { name: "Refresh" }).click();

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
    const snapshot = await fetch(`${base}/api/v1/repo`).then((r) => r.json());
    const root = snapshot.commits.find((commit: { parent_ids: string[] }) => commit.parent_ids.length === 0);
    if (root) {
      await fetch(`${base}/api/v1/branches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "e2e/empty", from_commit: root.id }),
      });
    }
  });

  await nav(page, "Git").click();
  await page.locator(".cg-view-toolbar").getByRole("button", { name: "Refresh" }).click();

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
    const snapshot = await fetch(`${base}/api/v1/repo`).then((r) => r.json());
    const root = snapshot.commits.find((commit: { parent_ids: string[] }) => commit.parent_ids.length === 0);
    if (root) {
      await fetch(`${base}/api/v1/branches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "e2e/to-delete", from_commit: root.id }),
      });
    }
  });
  await page.locator(".cg-view-toolbar").getByRole("button", { name: "Refresh" }).click();

  // Empty branches are folded; open them only if they are currently folded.
  const toggle = page.locator(".cg-rail").getByRole("button", { name: /with no commits/ });
  if ((await toggle.innerText()).trimStart().startsWith("Show")) {
    await toggle.click();
  }

  const remove = page.getByRole("button", { name: "Delete branch e2e/to-delete" });
  await expect(remove).toBeVisible();
  await remove.click();

  const dialog = page.getByRole("dialog", { name: "Delete branch" });
  await expect(dialog).toContainText("e2e/to-delete");
  await expect(dialog).toContainText("every commit stays");
  await dialog.getByRole("button", { name: "Delete branch" }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete branch e2e/to-delete" })).toHaveCount(0);

  // The current branch has no delete affordance at all.
  await expect(page.getByRole("button", { name: "Delete branch main" })).toHaveCount(0);
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
    const sessions = await fetch(`${base}/api/v1/sessions`).then((r) => r.json());
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
  const workdir = path.join(path.resolve(__dirname, ".."), ".playwright-workdir");

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
    const sessions = await fetch(`${base}/api/v1/sessions`).then((r) => r.json());
    return sessions.find((session: { name: string }) => session.name === runName) as
      | { id: string; worktree_path: string }
      | undefined;
  }, name);
  expect(run?.worktree_path).toBeTruthy();
  const worktree = String(run?.worktree_path);

  // Give the run some context, and commit a code change in its worktree.
  await page.evaluate(async (sessionId) => {
    const base = window.contextgit!.apiBase;
    const headers = { "Content-Type": "application/json" };
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

test("pick a provider and model from the chat picker", async () => {
  const page = await openShell();
  await nav(page, "Chat").click();

  const trigger = page.locator(".cg-model-btn");
  await expect(trigger).toContainText("Claude Sonnet 4.6");

  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("ChatGPT");

  await dialog.getByLabel("Search providers and models").fill("gemini");
  await dialog.getByRole("button", { name: /Gemini 3\.1 Pro/ }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger.locator(".cg-model-btn-model")).toHaveText("Gemini 3.1 Pro");
  await expect(trigger.locator(".cg-model-btn-provider")).toHaveText("Gemini");
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
  await expect(page.locator(".cg-thinking")).toBeVisible();

  // Reply streams, then settles into a committed assistant message.
  await expect(page.locator(".cg-thinking")).toHaveCount(0, { timeout: 25_000 });
  await expect(log.getByText(/Short answer: in-process with an LRU/)).toBeVisible();
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

  // Delete it (with confirmation) — the row disappears.
  await page.getByRole("button", { name: /Delete conversation chat\/e2e-convo/ }).click();
  const confirm = page.getByRole("dialog", { name: "Delete conversation" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Delete conversation" }).click();
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
  await expect(council.locator(".cg-council-col")).toHaveCount(3, { timeout: 25_000 });
  await expect(council).toContainText("dissents");

  await council.locator(".cg-council-col").first().getByRole("button", { name: "Keep this" }).click();
  await expect(council).toContainText("kept Claude");
});

test("research mode runs the steps and lands a cited report", async () => {
  const page = await openShell();
  await nav(page, "Chat").click();
  await mode(page, "Research").click();

  await page.locator("#cg-chat-prompt").fill("In-process vs Redis for a rate-limit bucket");
  await page.getByRole("button", { name: "Send message" }).click();

  const run = page.locator(".cg-research");
  await expect(run).toBeVisible();
  await expect(run.locator(".cg-steps li")).toHaveCount(5);
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

test("governor lists compaction receipts and locks the dead end", async () => {
  const page = await openShell();
  await nav(page, "Chat").click();

  const governor = page.locator(".cg-governor");
  await expect(governor).toContainText("Context governor");
  await expect(governor.locator(".cg-receipt")).toHaveCount(5);
  await expect(governor.locator('.cg-receipt[data-kind="dead-end"]')).toContainText("locked");
  await expect(
    governor.locator('.cg-receipt[data-kind="dropped"]').first().locator("input"),
  ).toBeEnabled();
});

test("the Docs sub-tab in Chat has the creator", async () => {
  const page = await openShell();
  await nav(page, "Chat").click();

  // The Chat tab's own sub-tab (not the composer modes).
  await page.locator(".cg-view-toolbar").getByRole("tab", { name: "Docs" }).click();
  await expect(page.locator(".cg-docs")).toBeVisible();

  const format = page.getByLabel("Document format");
  await expect(format).toBeVisible();
  await expect(format.locator("option")).toHaveCount(4);

  const style = page.getByLabel("Document style");
  await expect(style).toBeVisible();
  await expect(style.locator("option")).toHaveCount(3);
});

test("the Usage tab shows the merged token view", async () => {
  const page = await openShell();
  await nav(page, "Usage").click();

  const usage = page.locator(".cg-usage");
  await expect(usage).toBeVisible();
  await expect(usage.getByRole("heading", { name: "Usage" })).toBeVisible();
  // The streak panel and contribution graph render.
  await expect(usage.locator(".cg-usage-streak")).toBeVisible();
  await expect(usage.locator(".cg-heat-grid")).toBeVisible();
  await expect(usage.locator(".cg-heat-legend")).toContainText("More");
  await expect(usage.locator(".cg-usage-row").first()).toBeVisible();
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
  await expect(page.locator(".cg-view-toolbar")).toContainText(teamName, { timeout: 10_000 });

  // Two tasks, the second depending on the first (seeded through the API, as
  // the other tests seed commits).
  const ids = await page.evaluate(async () => {
    const base = window.contextgit!.apiBase;
    const post = async (path: string, body: unknown) => {
      const response = await fetch(base + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    (id) => fetch(`${window.contextgit!.apiBase}/api/v1/team/tasks/${id}/complete`, { method: "POST" }),
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
  const workdir = path.join(path.resolve(__dirname, ".."), ".playwright-workdir");
  const boardFile = fs.readFileSync(path.join(workdir, ".contextgit", "team.md"), "utf8");
  expect(boardFile).toContain("e2e api");
  expect(boardFile).toContain("e2e web");
  expect(boardFile).toContain("### Done");

  // Leave the app on Single so nothing downstream inherits Team mode.
  await modeSwitch.getByRole("tab", { name: "Single" }).click();
  await expect(page.getByRole("button", { name: "New terminal" })).toBeVisible();
});
