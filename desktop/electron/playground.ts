import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { augmentedPath, findCommand, installHarness, cancelInstall } from "./harness";
import { checkTarget, configEntry, readTarget, mergeMcpConfig, writeChanges, type FileChange } from "./playgroundFiles";
import { inspectMcp } from "./playgroundRpc";
import { sandboxPlan } from "./playgroundSandbox";
import { playgroundItem, type PlaygroundPreview, type PlaygroundInstalled, type PlaygroundEvent, type PlaygroundTryResult } from "../shared/playground";

interface Plan { preview: PlaygroundPreview; changes: FileChange[]; createdAt: number }

export class Playground {
  private plans = new Map<string, Plan>();
  private busy: string | null = null;
  private trying = false;

  constructor(
    private dataDir: string,
    private workspace: () => string | null,
    private repoPath: string,
    private mcpCommand: string | null,
    private onEvent: (event: PlaygroundEvent) => void,
  ) {}

  private root(): string {
    const root = this.workspace();
    if (!root) throw new Error("Choose a project before installing or trying an item.");
    return fs.realpathSync(root);
  }
  private prefix(id: string): string { return path.join(this.dataDir, "packages", id); }
  private bin(id: string): string {
    const install = playgroundItem(id).install;
    if (install.kind !== "npm") throw new Error("Item has no npm executable.");
    return path.join(this.prefix(id), "node_modules", install.pkg, install.bin);
  }
  private installedFile(): string { return path.join(this.dataDir, "playground.json"); }

  installed(): PlaygroundInstalled[] {
    if (!fs.existsSync(this.installedFile())) return [];
    const entries: unknown = JSON.parse(fs.readFileSync(this.installedFile(), "utf8"));
    if (!Array.isArray(entries)) throw new Error("Invalid Playground installed manifest.");
    return entries.filter((entry): entry is PlaygroundInstalled =>
      !!entry && typeof entry.id === "string" && typeof entry.projectPath === "string" && typeof entry.installedAt === "string");
  }
  private remember(id: string, root: string): void {
    const install = playgroundItem(id).install;
    const entries = this.installed().filter((entry) => entry.id !== id || entry.projectPath !== root);
    entries.push({ id, projectPath: root, installedAt: new Date().toISOString(), version: install.kind === "npm" ? install.version : undefined });
    fs.mkdirSync(this.dataDir, { recursive: true });
    const temporary = `${this.installedFile()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.installedFile());
  }

  async preview(id: string): Promise<PlaygroundPreview> {
    const item = playgroundItem(id);
    const root = this.root();
    const commands: string[][] = [];
    const changes: FileChange[] = [];
    const findings = [item.trust === "first-party"
      ? "Bundled ContextGit content; no third-party download."
      : "Curated, pinned package metadata reviewed. Publisher code and dependencies are not security-certified."];
    const effects: string[] = [];
    let blocked = false;
    const addFile = (target: string, after: string) => {
      const before = readTarget(root, target);
      changes.push({ path: target, before, after });
    };
    const node = await findCommand("node");
    if (item.install.kind === "docs") {
      blocked = true; findings.push(item.install.reason);
    } else if (item.install.kind === "skill") {
      const target = path.join(root, ".agents", "skills", id.slice(6), "SKILL.md");
      const before = readTarget(root, target);
      if (before && before !== item.install.content) throw new Error("An existing skill differs. Move it before installing this bundled skill.");
      addFile(target, item.install.content);
    } else if (item.install.kind === "mcp-config") {
      if (!this.mcpCommand) { blocked = true; findings.push("contextgit-mcp is not available. Install ContextGit's optional MCP dependency first."); }
      else {
        const target = path.join(root, ".mcp.json");
        addFile(target, mergeMcpConfig(readTarget(root, target), id, { command: this.mcpCommand, args: ["--repo", this.repoPath] }));
      }
    } else {
      const npm = await findCommand(process.platform === "win32" ? "npm.cmd" : "npm");
      if (!node || !npm || process.platform === "win32") {
        blocked = true; findings.push("Automatic npm installation requires Node/npm and currently supports Linux and macOS. Use the docs on Windows.");
      }
      commands.push([npm ?? "npm", "install", "--prefix", this.prefix(id), "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact", `${item.install.pkg}@${item.install.version}`]);
      effects.push(`npm writes package.json, package-lock.json and node_modules under ${this.prefix(id)} and uses its normal package cache. Lifecycle scripts are disabled. The project package.json is untouched.`);
      if (id === "warden") effects.push("The first Warden invocation downloads its platform binary from GitHub into ~/.cache/warden; doctor may probe sandbox backends. Installing the launcher alone does not prove sandbox readiness.");
      if (id === "modelcheck") effects.push("Try displays CLI help only. Model evaluations require provider credentials, may incur charges, and are run explicitly through the CLI.");
      if (item.sandbox && node) {
        if (!fs.existsSync(this.bin("warden"))) { blocked = true; findings.push(`Install Warden first. ${item.label} is only configured through Warden's sandbox.`); }
        const plan = sandboxPlan(item, root, node, this.prefix(id), this.bin(id), this.bin("warden"));
        findings.push(`Sandbox read access: ${item.sandbox.projectRead ? "this project and the installed package" : "the installed package only"}. Write access: ${plan.stateDirectory ?? "none"}. Network hosts: ${item.sandbox.network?.join(", ") || "none"}. Environment: ${Object.keys(plan.env).join(", ") || "none"}.`);
        const before = readTarget(root, plan.policyPath);
        if (before && before !== plan.policy) throw new Error("Existing sandbox policy differs. Review it manually before replacing it.");
        addFile(plan.policyPath, plan.policy);
        const target = path.join(root, ".mcp.json");
        addFile(target, mergeMcpConfig(readTarget(root, target), id, plan.entry));
        if (plan.stateDirectory) effects.push(`Creates ${plan.stateDirectory} for sandboxed state writes.`);
        effects.push("Warden refuses execution when the host cannot enforce this policy. It can download its binary into ~/.cache/warden and write audit logs under ~/.local/state/warden on first execution.");
      }
    }
    const preview: PlaygroundPreview = {
      token: randomUUID(), itemId: id, projectPath: root,
      verdict: { status: blocked ? "blocked" : "review", findings },
      files: changes.map((change) => change.path.endsWith(".mcp.json")
        ? { ...change, before: configEntry(change.before, id), after: configEntry(change.after, id) } : change),
      commands, effects,
    };
    for (const [token, plan] of this.plans) if (Date.now() - plan.createdAt > 300_000) this.plans.delete(token);
    if (this.plans.size >= 100) this.plans.clear();
    this.plans.set(preview.token, { preview, changes, createdAt: Date.now() });
    return preview;
  }

  async install(token: string): Promise<void> {
    if (this.busy) throw new Error("Another Playground install is running.");
    const plan = this.plans.get(token); this.plans.delete(token);
    if (!plan || Date.now() - plan.createdAt > 300_000) throw new Error("Preview expired. Review a new preview.");
    const { preview, changes } = plan;
    if (preview.verdict.status === "blocked") throw new Error("Install is blocked by the review gate.");
    if (this.root() !== preview.projectPath) throw new Error("Project changed since preview.");
    for (const change of changes) if (readTarget(preview.projectPath, change.path) !== change.before) throw new Error("Files changed since preview.");
    const item = playgroundItem(preview.itemId);
    this.busy = item.id;
    try {
      this.onEvent({ id: item.id, phase: "installing", percent: 0.05, line: "Applying reviewed install…" });
      if (item.install.kind === "npm") {
        const spec = item.install;
        fs.mkdirSync(this.prefix(item.id), { recursive: true });
        let installed = false;
        await installHarness({ id: `playground-${item.id}`, label: item.label, monogram: "", command: "node", args: [], npmPackage: `${spec.pkg}@${spec.version}` },
          (event) => {
            if (event.phase === "done") installed = true;
            else if (event.phase !== "checking") this.onEvent({ ...event, phase: event.phase, id: item.id });
          }, { prefix: this.prefix(item.id), verifyPath: this.bin(item.id) });
        if (!installed) return;
      }
      if (this.root() !== preview.projectPath) throw new Error("Project changed during install; downloaded packages remain, config was not written.");
      if (item.sandbox?.writeDirectory) {
        const cache = path.join(preview.projectPath, item.sandbox.writeDirectory);
        // Use the same symlink protection as config/skill writes.
        checkTarget(preview.projectPath, cache);
        fs.mkdirSync(cache, { recursive: true });
      }
      writeChanges(preview.projectPath, changes);
      this.remember(item.id, preview.projectPath);
      this.onEvent({ id: item.id, phase: "done", percent: 1, line: "Installed in this project." });
    } finally { this.busy = null; }
  }

  cancel(id: string): void {
    if (this.busy === id) cancelInstall(`playground-${id}`);
  }

  async tryItem(id: string, tool: string, input: Record<string, unknown>): Promise<PlaygroundTryResult> {
    if (this.trying || this.busy) throw new Error("Wait for the current Playground operation to finish.");
    const root = this.root(); const item = playgroundItem(id);
    if (!item.tryTools?.includes(tool)) throw new Error("Tool is not permitted in Try.");
    if (!input || typeof input !== "object" || Array.isArray(input) || JSON.stringify(input).length > 8192) throw new Error("Arguments must be a JSON object under 8 KB.");
    if (!this.installed().some((entry) => entry.id === id && entry.projectPath === root)) throw new Error("Install the item in this project first.");
    const env: NodeJS.ProcessEnv = { PATH: await augmentedPath(), NODE_ENV: "production", NO_COLOR: "1", CI: "1" };
    const node = await findCommand("node");
    this.trying = true;
    try {
      if (id === "contextgit" && this.mcpCommand) {
        return await inspectMcp(this.mcpCommand, ["--repo", this.repoPath], root, env, tool, input, item.tryTools);
      }
      if (!node || item.install.kind !== "npm" || !fs.existsSync(this.bin(id))) throw new Error("Installed executable is unavailable.");
      if (item.sandbox) {
        const plan = sandboxPlan(item, root, node, this.prefix(id), this.bin(id), this.bin("warden"));
        if (readTarget(root, plan.policyPath) !== plan.policy) throw new Error("Sandbox policy changed. Review a fresh install.");
        if (plan.stateDirectory) checkTarget(root, plan.stateDirectory);
        Object.assign(env, plan.env);
        // These are for Warden itself; only names in the policy's env.allow
        // reach the MCP server inside the sandbox.
        env.HOME = process.env.HOME;
        env.USERPROFILE = process.env.USERPROFILE;
        return await inspectMcp(node, [this.bin("warden"), "run", "--policy", plan.policyPath], root, env, tool, input, item.tryTools);
      }
      const args = [this.bin(id), id === "warden" ? "doctor" : "--help"];
      if (id === "warden") {
        // Warden's launcher/cache and Go diagnostics need the real user's home;
        // credential variables and the backend launch token stay excluded.
        env.HOME = process.env.HOME;
        env.USERPROFILE = process.env.USERPROFILE;
      }
      return { request: { command: node, args }, response: await runDiagnostic(node, args, root, env) };
    } finally { this.trying = false; }
  }
}

function runDiagnostic(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    let output = ""; let settled = false;
    const finish = (error?: Error, code?: number | null) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve({ exitCode: code, output });
      if (error) {
        if (process.platform !== "win32" && child.pid) {
          try { process.kill(-child.pid, "SIGKILL"); } catch { /* already exited */ }
        } else child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(() => finish(new Error("Diagnostic timed out after 20 seconds.")), 20_000);
    const capture = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 65536) finish(new Error("Diagnostic output exceeded 64 KB."));
    };
    child.stdout.on("data", capture); child.stderr.on("data", capture);
    child.on("error", (error) => finish(error)); child.on("close", (code) => finish(undefined, code));
  });
}
