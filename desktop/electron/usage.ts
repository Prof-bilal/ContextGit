import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { StringDecoder } from "node:string_decoder";
import type { HarnessLimits } from "../../lib/api";
import { HARNESS_BY_ID } from "../shared/harnesses";
import { augmentedPath, checkHarness } from "./harness";
import { aiderReport, codexLimits, emptyUsage, geminiCounters, jsonRecords, statsTotals } from "./usageParsers";

interface Run {
  sessionId: string; harness: string; cwd: string; file: string;
  snapshot: HarnessLimits; timer?: ReturnType<typeof setInterval>;
  offset: number; pending: string; decoder: StringDecoder;
  counters: Map<string, number>; line: string; tokens: number;
  fingerprint?: string; watcher?: fs.FSWatcher; debounce?: ReturnType<typeof setTimeout>; active?: boolean;
}
const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

export class UsageManager {
  private runs = new Map<string, Run>();
  private accounts = new Map<string, { time: number; value: HarnessLimits }>();
  private requests = new Map<string, Promise<HarnessLimits>>();
  private listeners = new Set<(value: HarnessLimits) => void>();
  private visible = false;
  private integrationActive = false;
  private failures = new Map<string, { count: number; retry: number }>();
  private codex: SharedCodexUsage | null = null;
  constructor(private directory: string, private helpers: string) {}
  subscribe(listener: (value: HarnessLimits) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(value: HarnessLimits): void { for (const listener of this.listeners) listener(value); }
  activity(visible: boolean, integrationActive = false): void {
    this.visible = visible; this.integrationActive = integrationActive;
    this.updateConnection();
  }
  private updateConnection(): void {
    const active = this.visible || this.integrationActive || [...this.runs.values()].some(run => run.active && run.harness === "codex");
    if (active && !this.codex) {
      this.codex = new SharedCodexUsage(value => {
        this.accounts.set("codex", { time: Date.now(), value }); this.emit(value);
      });
      void this.codex.start();
    } else if (!active && this.codex) { this.codex.stop(); this.codex = null; }
  }
  ingest(value: HarnessLimits): void { this.emit(value); }


  prepare(ptyId: string, sessionId: string, harness: string, cwd: string): { args: string[]; env: Record<string, string> } {
    try { return this.prepareRun(ptyId, sessionId, harness, cwd); }
    catch {
      this.finish(ptyId);
      const snapshot: HarnessLimits = { ...emptyUsage(harness, "Usage tracking could not start. The CLI remains available.", "error"), scope: "session", session_id: sessionId };
      this.runs.set(ptyId, { sessionId, harness, cwd, file: "", snapshot,
        offset: 0, pending: "", decoder: new StringDecoder("utf8"), counters: new Map(), line: "", tokens: 0 });
      return { args: [], env: {} };
    }
  }

  private prepareRun(ptyId: string, sessionId: string, harness: string, cwd: string): { args: string[]; env: Record<string, string> } {
    this.finish(ptyId);
    const args: string[] = [], env: Record<string, string> = {};
    // Instrument only these CLIs; an unknown shell/agent receives no extra flags.
    if (!["claude", "gemini", "pi", "aider", "opencode", "kilo", "codex"].includes(harness)) return { args, env };
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const file = path.join(this.directory, `${ptyId.replace(/[^a-zA-Z0-9_-]/g, "_")}-${randomUUID()}.json`);
    const run: Run = { sessionId, harness, cwd, file, snapshot: emptyUsage(harness, "Usage appears after activity in this run.", "waiting"),
      offset: 0, pending: "", decoder: new StringDecoder("utf8"), counters: new Map(), line: "", tokens: 0 };
    run.snapshot.scope = "session";
    run.snapshot.session_id = sessionId;
    run.snapshot.launch_id = randomUUID();
    run.snapshot.launch_started_at = new Date().toISOString();
    run.active = true;
    this.runs.set(ptyId, run);
    this.updateConnection();
    this.emit(run.snapshot);
    env.CONTEXTGIT_USAGE_FILE = file;
    if (harness === "claude") {
      let original: Record<string, any> = {};
      for (const settings of [path.join(homedir(), ".claude", "settings.json"), path.join(cwd, ".claude", "settings.json"), path.join(cwd, ".claude", "settings.local.json")]) {
        try { const value = JSON.parse(fs.readFileSync(settings, "utf8")); if (value.statusLine) original = value.statusLine; } catch { /* missing settings */ }
      }
      if (typeof original.command === "string") env.CONTEXTGIT_STATUS_COMMAND = original.command;
      const helper = path.join(this.helpers, "usage-statusline.cjs");
      if (!fs.existsSync(helper)) throw new Error("Usage helper missing");
      const command = process.platform === "win32"
        ? `set ELECTRON_RUN_AS_NODE=1&& "${process.execPath}" "${helper}"`
        : `env ELECTRON_RUN_AS_NODE=1 ${shellQuote(process.execPath)} ${shellQuote(helper)}`;
      args.push("--settings", JSON.stringify({ statusLine: { ...original, type: "command", command } }));
    } else if (harness === "gemini") {
      Object.assign(env, { GEMINI_TELEMETRY_ENABLED: "true", GEMINI_TELEMETRY_TARGET: "local", GEMINI_TELEMETRY_OUTFILE: file,
        GEMINI_TELEMETRY_LOG_PROMPTS: "false", GEMINI_TELEMETRY_TRACES_ENABLED: "false", GEMINI_TELEMETRY_USE_COLLECTOR: "false" });
    } else if (harness === "pi") {
      const helper = path.join(this.helpers, "usage-pi.mjs");
      if (!fs.existsSync(helper)) throw new Error("Usage helper missing");
      args.push("--extension", helper);
    }
    if (["claude", "gemini", "pi"].includes(harness)) {
      run.timer = setInterval(() => this.readRun(run), 1000);
      // Watch the directory so atomic status-line replacement is observed too.
      run.watcher = fs.watch(this.directory, (_event, filename) => {
        if (filename?.toString() !== path.basename(run.file)) return;
        if (run.debounce) clearTimeout(run.debounce);
        run.debounce = setTimeout(() => this.readRun(run), 75);
      });
    }
    if (["opencode", "kilo"].includes(harness)) {
      run.timer = setInterval(() => { void this.read(harness, sessionId).catch(() => {}); }, 30_000);
    }
    return { args, env };
  }

  private readRun(run: Run): void {
    try {
      let totals = null;
      if (run.harness === "gemini") {
        const size = fs.statSync(run.file).size;
        if (size < run.offset) { run.offset = 0; run.pending = ""; run.counters.clear(); run.decoder = new StringDecoder("utf8"); }
        const count = Math.min(size - run.offset, 1024 * 1024);
        if (count <= 0) return;
        const buffer = Buffer.alloc(count);
        const fd = fs.openSync(run.file, "r");
        try { run.offset += fs.readSync(fd, buffer, 0, count, run.offset); } finally { fs.closeSync(fd); }
        const parsed = jsonRecords(run.pending + run.decoder.write(buffer));
        run.pending = parsed.remaining.length <= 1024 * 1024 ? parsed.remaining : "";
        for (const record of parsed.records) totals = geminiCounters(record, run.counters) ?? totals;
      } else {
        if (fs.statSync(run.file).size > 1024 * 1024) return;
        const contents = fs.readFileSync(run.file, "utf8");
        if (contents === run.fingerprint) return;
        const data = JSON.parse(contents);
        run.fingerprint = contents;
        if (run.harness === "claude") {
          run.snapshot.windows = data.windows ?? [];
          totals = data.totals ?? null;
        } else totals = data;
      }
      if (!totals && !run.snapshot.windows.length) return;
      run.snapshot = { ...run.snapshot, totals, state: "available", signed_in: true, source: `${run.harness} local observer`,
        fetched_at: new Date(fs.statSync(run.file).mtimeMs).toISOString(), message: run.harness === "gemini" ? "Account quota is available in the CLI with /stats model." : null };
      this.emit(run.snapshot);
    } catch { /* Wait for a complete record; never affect the CLI. */ }
  }

  observe(ptyId: string, chunk: string): void {
    const run = this.runs.get(ptyId);
    if (!run || run.harness !== "aider") return;
    const lines = (run.line + chunk).split(/\r?\n/);
    run.line = (lines.pop() ?? "").slice(-8192);
    for (const line of lines) {
      const report = aiderReport(line);
      if (!report) continue;
      if (report.tokens !== null) run.tokens += report.tokens;
      run.snapshot = { ...run.snapshot, state: "available", signed_in: true, source: "Aider CLI output",
        fetched_at: new Date().toISOString(), message: "CLI-reported usage; token counts and costs may be estimated.",
        totals: { total_tokens: run.tokens, total_cost: report.cost ?? run.snapshot.totals?.total_cost ?? null, requests: null, period: "this launch" } };
      this.emit(run.snapshot);
    }
  }

  finish(ptyId: string): void {
    const run = this.runs.get(ptyId);
    if (run) {
      this.readRun(run); if (run.timer) clearInterval(run.timer); run.timer = undefined;
      run.watcher?.close(); run.watcher = undefined;
      if (run.debounce) clearTimeout(run.debounce);
      run.active = false;
      this.updateConnection();
    }
  }
  stop(): void { this.visible = false; this.integrationActive = false; for (const id of this.runs.keys()) this.finish(id); this.codex?.stop(); this.codex = null; }

  async read(harness: string, sessionId?: string, refresh = false): Promise<HarnessLimits> {
    const run = [...this.runs.values()].reverse().find((run) => run.sessionId === sessionId && run.harness === harness);
    if (["claude", "gemini", "pi", "aider"].includes(harness)) {
      if (run) { this.readRun(run); return run.snapshot; }
      return emptyUsage(harness, "Usage tracking is available on the next launch of this run.", "waiting");
    }
    if (harness === "ollama") return emptyUsage(harness, "Local inference has no account quota. Cloud usage is available on Ollama’s usage page.");
    if (harness === "shell") return emptyUsage(harness, "Usage tracking does not apply to a plain shell.");
    if (!["codex", "opencode", "kilo"].includes(harness)) return emptyUsage(harness, "Account readings come from the backend adapter.");
    if (harness !== "codex" && !run) return emptyUsage(harness, "Local project usage is available after launching this run.", "waiting");
    const key = harness === "codex" ? harness : `${harness}:${run!.cwd}`;
    const scoped = (value: HarnessLimits): HarnessLimits => run && harness !== "codex"
      ? { ...value, session_id: run.sessionId, launch_id: run.snapshot.launch_id, launch_started_at: run.snapshot.launch_started_at }
      : value;
    const cached = this.accounts.get(key);
    if (!refresh && cached && Date.now() - cached.time < (this.visible || this.integrationActive || run?.active ? 30_000 : 300_000)) return scoped(cached.value);
    const failure = this.failures.get(key);
    if (!refresh && failure && Date.now() < failure.retry && cached) return scoped(cached.value);
    if (harness === "codex" && this.codex) return this.codex.read(refresh);
    const active = this.requests.get(key);
    if (active) { const value = scoped(await active); this.emit(value); return value; }
    const request = this.fetch(harness, run?.cwd).then((value) => {
      if (value.state === "error") {
        const count = (this.failures.get(key)?.count ?? 0) + 1;
        this.failures.set(key, { count, retry: Date.now() + Math.min(300_000, 30_000 * 2 ** (count - 1)) });
        if (cached?.value.state === "available") value = { ...cached.value, stale: true, message: value.message };
      } else this.failures.delete(key);
      this.accounts.set(key, { time: Date.now(), value });
      return value;
    }).finally(() => this.requests.delete(key));
    this.requests.set(key, request);
    const value = scoped(await request);
    this.emit(value);
    return value;
  }

  private async fetch(harness: string, cwd?: string): Promise<HarnessLimits> {
    try {
      const checked = await checkHarness(HARNESS_BY_ID[harness]);
      if (!checked.path) return emptyUsage(harness, "This CLI is not installed.", "unsupported");
      const env = { ...process.env, PATH: await augmentedPath() };
      if (harness === "codex") return await readCodex(checked.path, env);
      const output = await commandOutput(checked.path, ["stats", "--project", ""], cwd, env);
      const totals = statsTotals(output);
      if (!totals) return emptyUsage(harness, "This CLI version returned an unrecognized usage format.", "unsupported");
      return { ...emptyUsage(harness, "Account allowances depend on the configured provider.", "available"), signed_in: true, source: `${harness} stats · polled project totals`, scope: "local_project", totals };
    } catch (cause) {
      const message = cause instanceof Error && cause.message === "timeout" ? "Usage lookup timed out. Refresh to retry." : "Could not read CLI usage. Check its login and installed version.";
      return emptyUsage(harness, message, "error");
    }
  }
}

export function commandOutput(command: string, args: string[], cwd: string | undefined, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    let output = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("timeout")); }, 10_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data) => { output += data; if (output.length > 1024 * 1024) { child.kill(); reject(new Error("output limit")); } });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code) => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error("CLI failed")); });
  });
}

export function readCodex(command: string, env: NodeJS.ProcessEnv): Promise<HarnessLimits> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ["app-server", "--listen", "stdio://"], { env, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    let pending = "", account: unknown, settled = false;
    const timer = setTimeout(() => finish(undefined, new Error("timeout")), 10_000);
    const finish = (value?: HarnessLimits, error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); child.kill();
      if (error) reject(error); else resolve(value!);
    };
    const send = (value: unknown) => child.stdin.write(JSON.stringify(value) + "\n");
    child.stdin.on("error", (error) => finish(undefined, error));
    child.on("error", (error) => finish(undefined, error));
    child.on("exit", () => { if (!settled) finish(undefined, new Error("CLI failed")); });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
      pending += data;
      if (pending.length > 1024 * 1024) return finish(undefined, new Error("output limit"));
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        try {
          const response = JSON.parse(line);
          if (response.id && response.error) return finish(emptyUsage("codex", "Codex could not return account limits. Check its login or update the CLI.", "error"));
          if (response.id === 1) { send({ method: "initialized" }); send({ id: 2, method: "account/read", params: { refreshToken: false } }); }
          else if (response.id === 2) {
            account = response.result;
            if (!response.result?.account || ["apiKey", "amazonBedrock"].includes(response.result.account.type)) return finish(codexLimits({}, account));
            send({ id: 3, method: "account/rateLimits/read" });
          } else if (response.id === 3) return finish(codexLimits(response.result, account));
        } catch { /* Ignore diagnostics that are not protocol records. */ }
      }
    });
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "contextgit_usage", title: "ContextGit Usage", version: "0.1.0" } } });
  });
}

/** One read-only account connection shared by visible Code and background runs. */
export class SharedCodexUsage {
  private child: ReturnType<typeof spawn> | null = null;
  private account: unknown;
  private value: HarnessLimits | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private pending = "";
  private id = 10;
  private reading: Promise<HarnessLimits> | null = null;
  private resolve?: (value: HarnessLimits) => void;
  private timeout?: ReturnType<typeof setTimeout>;
  private requests = new Map<number, "account" | "limits">();
  private stopped = false;
  private initialized = false;
  private starting: Promise<void> | null = null;
  private failures = 0;
  private retryAt = 0;
  constructor(private publish: (value: HarnessLimits) => void, private testCommand?: string) {}
  start(): Promise<void> {
    if (this.starting) return this.starting;
    this.starting = this.connect().finally(() => { this.starting = null; });
    return this.starting;
  }
  private async connect(): Promise<void> {
    if (this.child || this.stopped || Date.now() < this.retryAt) return;
    try {
      const checked = this.testCommand ? { path: this.testCommand } : await checkHarness(HARNESS_BY_ID.codex);
      if (!checked.path || this.stopped) return;
      const env = { ...process.env, PATH: await augmentedPath() };
      if (this.stopped) return;
      const child = spawn(checked.path, ["app-server", "--listen", "stdio://"], { env, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
      this.child = child; this.pending = ""; this.initialized = false; this.requests.clear();
      child.stdin?.on("error", () => this.fail());
      child.on("error", () => this.fail());
      child.on("exit", () => { if (this.child === child) { this.child = null; this.fail(); } });
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (data: string) => {
        this.pending += data;
        if (this.pending.length > 1024 * 1024) { this.fail(); child.kill(); return; }
        let newline: number;
        while ((newline = this.pending.indexOf("\n")) >= 0) {
          const line = this.pending.slice(0, newline); this.pending = this.pending.slice(newline + 1);
          try { this.record(JSON.parse(line)); } catch { /* Non-protocol diagnostics. */ }
        }
      });
      this.send({ id: 1, method: "initialize", params: { clientInfo: { name: "contextgit_usage", version: "0.1.0" } } });
      if (!this.timer) this.timer = setInterval(() => void this.read(), 30_000);
    } catch { this.fail(); }
  }
  private send(value: unknown): void { this.child?.stdin?.write(JSON.stringify(value) + "\n"); }
  private query(method: "account/read" | "account/rateLimits/read"): void {
    const id = ++this.id;
    this.requests.set(id, method === "account/read" ? "account" : "limits");
    this.send({ id, method, ...(method === "account/read" ? { params: { refreshToken: false } } : {}) });
  }
  private record(record: any): void {
    if (record.error) { this.fail(); return; }
    if (record.id === 1) { this.initialized = true; this.send({ method: "initialized" }); this.query("account/read"); return; }
    if (record.method === "account/updated") {
      // Never display readings for the previous identity during an auth transition.
      this.account = undefined; this.value = null;
      this.publish(emptyUsage("codex", "Authentication changed; refreshing account limits.", "waiting"));
      this.requests.clear(); this.query("account/read"); return;
    }
    if (record.method === "account/rateLimits/updated") {
      if (this.account) this.accept({ ...codexLimits(record.params, this.account), source: "Codex app-server · quota notification" });
      return;
    }
    const kind = this.requests.get(record.id);
    this.requests.delete(record.id);
    if (kind === "account") {
      this.account = record.result;
      if (!record.result?.account || ["apiKey", "amazonBedrock"].includes(record.result.account.type)) this.accept(codexLimits({}, this.account));
      else this.query("account/rateLimits/read");
    } else if (kind === "limits") this.accept({ ...codexLimits(record.result, this.account), source: "Codex app-server · polled account reading" });
  }
  private accept(value: HarnessLimits): void {
    this.failures = 0; this.retryAt = 0; this.value = value;
    this.publish(value); this.resolve?.(value); this.resolve = undefined;
    if (this.timeout) clearTimeout(this.timeout);
  }
  private fail(): void {
    if (this.stopped) return;
    const child = this.child; this.child = null; this.initialized = false; child?.kill();
    this.failures++; this.retryAt = Date.now() + Math.min(300_000, 30_000 * 2 ** (this.failures - 1));
    const value = this.value?.state === "available" ? { ...this.value, stale: true, message: "Codex usage refresh failed." } : emptyUsage("codex", "Codex usage refresh failed.", "error");
    this.value = value; this.publish(value); this.resolve?.(value); this.resolve = undefined;
    if (this.timeout) clearTimeout(this.timeout);
  }
  read(refresh = false): Promise<HarnessLimits> {
    if (this.reading) return this.reading;
    if (!refresh && Date.now() < this.retryAt && this.value) return Promise.resolve(this.value);
    if (refresh) this.retryAt = 0;
    this.reading = new Promise<HarnessLimits>(resolve => {
      this.resolve = resolve;
      this.timeout = setTimeout(() => this.fail(), 10_000);
      void this.start().then(() => { if (this.child && this.initialized) this.query("account/read"); else if (!this.child) this.fail(); });
    }).finally(() => { this.reading = null; });
    return this.reading;
  }
  stop(): void {
    this.stopped = true; if (this.timer) clearInterval(this.timer);
    if (this.timeout) clearTimeout(this.timeout);
    this.resolve?.(this.value ?? emptyUsage("codex", "Account polling paused.", "waiting"));
    this.child?.kill(); this.child = null;
  }
}
