/** Focused MVP smoke tests against a real desktop/backend and private test data. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { electronExecutable } from "./electron-path";

let app: ElectronApplication;
let page: Page;
let directory: string;
let project: string;
let savedSession: { id: string; branch: string };
let savedCommit: string;
const root = path.resolve(__dirname, "..");
const nav = (name: string) => page.locator(".cg-segmented").getByRole("tab", { name, exact: true });
const terminalReadyCommand = (index: number) => process.platform === "win32"
  ? `$env:CG_KEEP='alive'; Write-Output 'CG_READY_${index}'`
  : `CG_KEEP=alive; printf 'CG_READY_${index}\\n'; (while true; do printf 'CG_OUTPUT_${index}\\n'; sleep 1; done) &`;
const terminalAliveCommand = (index: number) => process.platform === "win32"
  ? `Write-Output \"CG_ALIVE_${index}=$env:CG_KEEP\"`
  : `printf 'CG_ALIVE_${index}=%s\\n' \"$CG_KEEP\"`;
test.describe.configure({ mode: "serial" });

async function api<T>(route: string, method = "GET", body?: unknown): Promise<T> {
  return page.evaluate(async ({ route, method, body }) => {
    const bridge = window.contextgit!;
    const result = await fetch(`${bridge.apiBase}/api/v1/${route}`, {
      method, headers: { Authorization: `Bearer ${bridge.apiToken}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!result.ok) throw new Error(await result.text());
    return result.status === 204 ? undefined : result.json();
  }, { route, method, body });
}

test.beforeAll(async () => {
  test.setTimeout(60_000);
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "cg-mvp-e2e-"));
  project = path.join(directory, "project");
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, "README.md"), "# Private MVP test project\n");
  const probe = net.createServer();
  await new Promise<void>(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  app = await electron.launch({
    executablePath: electronExecutable(root),
    args: [path.join(root, "desktop"), "--no-sandbox", `--user-data-dir=${path.join(directory, "profile")}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: "", CONTEXTGIT_PORT: String(port), CONTEXTGIT_WORKDIR: project },
  });
  page = await app.firstWindow();
  let logs = "";
  app.process().stderr?.on("data", chunk => { logs = (logs + chunk.toString()).slice(-8000); });
  try { await expect(page.locator(".cg-shell")).toBeVisible({ timeout: 40_000 }); }
  catch (error) { console.error("Desktop startup:", await page.locator("body").innerText(), logs); throw error; }
});

test.afterAll(async () => {
  await app?.close();
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
});

test("only Code and Git are public and keyboard navigation works", async () => {
  const tabs = page.locator(".cg-segmented").getByRole("tab");
  await expect(tabs).toHaveCount(2);
  await nav("Code").focus();
  await page.keyboard.press("ArrowRight");
  await expect(nav("Git")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(nav("Code")).toHaveAttribute("aria-selected", "true");
});

test("legacy URLs redirect to Code without mounting retired surfaces", async () => {
  const url = new URL(page.url());
  for (const tab of ["chat", "work", "issues", "assets"]) {
    url.searchParams.set("tab", tab);
    await page.goto(url.href);
    await expect(nav("Code")).toHaveAttribute("aria-selected", "true");
    expect(new URL(page.url()).searchParams.get("tab")).toBe("code");
    await expect(page.locator('[data-feature="chat"], [data-feature="issues"], [data-feature="assets"]')).toHaveCount(0);
  }
});

test("checkpoint conversation shows only persisted prompt and reply", async ({}, testInfo) => {
  // Deterministic UI fixture, not a provider response. Live harness capture has its own gate.
  savedSession = await api("sessions", "POST", { name: "MVP conversation proof", kind: "terminal", agent: "shell", project_path: project });
  await api(`sessions/${savedSession.id}/staging`, "POST", { messages: [
    { role: "user", content: "Please explain this project.\nKeep the formatting." },
    { role: "assistant", content: "Here is the saved AI reply.\nA second line stays readable." },
    { role: "tool", content: "USAGE_METADATA_MUST_NOT_RENDER" },
  ] });
  const result = await api<{ commit: { id: string } }>(`sessions/${savedSession.id}/commit`, "POST", { summary: "MVP conversation checkpoint" });
  savedCommit = result.commit.id;
  await nav("Git").click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByText("MVP conversation checkpoint", { exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Conversation", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".cg-history-transcript li")).toHaveCount(2);
  await expect(dialog).toContainText("Please explain this project.");
  await expect(dialog).toContainText("Here is the saved AI reply.");
  await expect(dialog).not.toContainText("USAGE_METADATA_MUST_NOT_RENDER");
  await page.screenshot({ path: testInfo.outputPath("conversation.png"), animations: "disabled" });
  await dialog.getByRole("button", { name: /Close/ }).click();
});

test("delete is recoverable and retains the immutable conversation", async () => {
  await api(`sessions/${savedSession.id}`, "DELETE");
  const trash = await api<{ sessions: { id: string }[] }>("trash");
  expect(trash.sessions.some(session => session.id === savedSession.id)).toBe(true);
  const conversation = await api<{ messages: { content: string }[] }>(`commits/${savedCommit}/conversation/page`);
  expect(conversation.messages).toHaveLength(2);
  await api(`sessions/${savedSession.id}/restore`, "POST");
  const restored = await api<{ id: string }>(`sessions/${savedSession.id}`);
  expect(restored.id).toBe(savedSession.id);
});

test("backend restart preserves durable history", async () => {
  const status = await page.evaluate(() => window.contextgit!.restartBackend());
  expect(status.status.state).toBe("ready");
  const conversation = await api<{ messages: { content: string }[] }>(`commits/${savedCommit}/conversation/page`);
  expect(conversation.messages[1].content).toContain("saved AI reply");
  await expect(page.locator(".cg-shell")).toBeVisible();
});

test("six live terminals remain usable across tab switching and backend restart", async () => {
  const duration = process.env.CONTEXTGIT_SOAK === "1" ? 1_800_000 : 10_000;
  test.setTimeout(duration + 120_000);
  const errors: string[] = [];
  const onError = (error: Error) => errors.push(error.message);
  page.on("pageerror", onError);
  await nav("Code").click();
  for (let index = 0; index < 6; index++) {
    await page.getByRole("button", { name: "New run", exact: true }).click();
    await page.getByLabel("Run name").fill(`reliability terminal ${index}`);
    await page.getByLabel("Agent", { exact: true }).selectOption("shell");
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    const pane = page.getByRole("region", { name: `reliability terminal ${index} terminal`, exact: true });
    await expect(pane).toBeVisible();
    await pane.locator(".cg-term-host").click();
    await page.keyboard.type(terminalReadyCommand(index));
    await page.keyboard.press("Enter");
    await expect(pane.locator(".xterm-accessibility-tree")).toContainText(`CG_READY_${index}`, { timeout: 15_000 });
  }
  const started = Date.now();
  let restarted = false;
  while (Date.now() - started < duration) {
    await nav("Git").click();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await nav("Code").click();
    await expect(page.locator(".cg-pane")).toHaveCount(6);
    if (!restarted) {
      await page.evaluate(() => window.contextgit!.restartBackend());
      restarted = true;
    }
    for (let index = 0; index < 6; index++) {
      const pane = page.getByRole("region", { name: `reliability terminal ${index} terminal`, exact: true });
      await pane.locator(".cg-term-host").click();
      await page.keyboard.type(terminalAliveCommand(index));
      await page.keyboard.press("Enter");
      await expect(pane.locator(".xterm-accessibility-tree")).toContainText(`CG_ALIVE_${index}=alive`);
      await pane.getByRole("button", { name: "Stage output", exact: true }).click();
      await expect(pane.locator(".cg-pane-exited")).toHaveCount(0);
    }
    expect(errors).toEqual([]);
    await new Promise(resolve => setTimeout(resolve, Math.min(5000, Math.max(0, duration - (Date.now() - started)))));
  }
  const closed = (await api<{ id: string; name: string }[]>("sessions")).find(session => session.name === "reliability terminal 0")!;
  await page.getByRole("region", { name: "reliability terminal 0 terminal", exact: true }).getByRole("button", { name: "Close reliability terminal 0" }).click();
  const retained = await api<{ id: string }>(`sessions/${closed.id}`);
  expect(retained.id).toBe(closed.id);
  expect((await api<unknown[]>(`sessions/${closed.id}/staging`)).length).toBeGreaterThan(0);
  page.off("pageerror", onError);
});
