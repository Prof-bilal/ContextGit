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
  fs.rmSync(workdir, { recursive: true, force: true });
  fs.mkdirSync(workdir, { recursive: true });
  const git = (...args: string[]) => spawnSync("git", args, { cwd: workdir });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "e2e@example.com");
  git("config", "user.name", "e2e");
  fs.writeFileSync(path.join(workdir, "README.md"), "# e2e project\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");

  app = await electron.launch({
    executablePath: path.join(root, "desktop/node_modules/electron/dist/electron"),
    args: [path.join(root, "desktop"), "--no-sandbox"],
    env: {
      ...process.env,
      CONTEXTGIT_REPO: path.join(root, ".playwright-contextgit-desktop"),
      CONTEXTGIT_PORT: "8757",
      CONTEXTGIT_WORKDIR: workdir,
    },
  });
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
