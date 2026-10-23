import { projectApi, type Session } from "@/shared/api";
import { readableTerminalOutput } from "./readableOutput";
import { registerTranscriptFlush } from "./transcriptFlush";
import { ptyIdForSession } from "./pty";

export type RuntimeSnapshot = {
  output: string;
  tail: string;
  state: "idle" | "starting" | "running" | "exited" | "error";
  error?: string;
};
type Entry = {
  session: Session;
  teamId?: string;
  taskId?: string;
  instruction?: string;
  snapshot: RuntimeSnapshot;
  listeners: Set<() => void>;
  pending: string;
  timer?: ReturnType<typeof setTimeout>;
  flight?: Promise<void>;
  launch: Promise<void>;
};

/** Process ownership lives here. Renderer subscriptions never start or stop a CLI. */
export class TerminalRuntime {
  private entries = new Map<string, Entry>();
  private listeners = new Map<string, Set<() => void>>();
  private outputListeners = new Map<string, Set<(data: string) => void>>();
  private connected = false;
  private sizes = new Map<string, {cols:number; rows:number}>();
  private retries = new Map<string, Promise<void>>();
  private connect() {
    if (this.connected) return;
    const bridge = window.contextgit;
    if (!bridge) throw new Error("Desktop terminal service is unavailable.");
    this.connected = true;
    bridge.onPtyData((id, data) => {
      const entry = [...this.entries.values()].find(
        (item) => ptyIdForSession(item.session.id) === id,
      );
      if (!entry) return;
      const output = (entry.snapshot.output + data).slice(-180_000);
      entry.snapshot = {
        ...entry.snapshot,
        output,
        tail: readableTerminalOutput(output.slice(-8000)).slice(-1400),
      };
      entry.pending += data;
      // Live emulators need every byte in order. The capped history is only
      // a replay/tail buffer; trimming it must never reset a running TUI.
      this.outputListeners.get(entry.session.id)?.forEach((listener) => listener(data));
      if (!entry.timer)
        entry.timer = setTimeout(() => {
          entry.timer = undefined;
          void this.flush(entry);
        }, 1500);
      entry.listeners.forEach((listener) => listener());
    });
    bridge.onPtyExit((id, code) => {
      const entry = [...this.entries.values()].find(
        (item) => ptyIdForSession(item.session.id) === id,
      );
      if (!entry) return;
      entry.snapshot = { ...entry.snapshot, state: "exited" };
      entry.listeners.forEach((listener) => listener());
      void this.flush(entry)
        .then(async () => {
          const api = projectApi(entry.session.project_path ?? undefined);
          await api.updateSession(entry.session.id, {
            status: code === 0 ? "done" : "error",
          });
          if (entry.session.auto_commit) {
            if (entry.session.agent === "opencode")
              await api.captureConversation(entry.session.id);
            else if (entry.snapshot.tail.trim())
              await api.stage(entry.session.id, [
                { role: "tool", content: entry.snapshot.tail },
              ]);
            if ((await api.staging(entry.session.id)).length)
              await api.commitStaged(
                entry.session.id,
                `checkpoint: ${entry.session.name}`,
              );
          }
        })
        .catch(() => {});
    });
  }
  async flush(entry: Entry): Promise<void> {
    if (entry.flight) {
      await entry.flight;
      if (entry.pending) return this.flush(entry);
      return;
    }
    if (!entry.pending) return;
    const content = entry.pending.slice(0, 90_000);
    entry.pending = entry.pending.slice(content.length);
    let failed = false;
    entry.flight = projectApi(entry.session.project_path ?? undefined)
      .appendTerminalTranscript(
        entry.session.id,
        readableTerminalOutput(content),
      )
      .then(() => {})
      .catch(() => {
        failed = true;
        entry.pending = content + entry.pending;
        if (!entry.timer)
          entry.timer = setTimeout(() => {
            entry.timer = undefined;
            void this.flush(entry);
          }, 4000);
      })
      .finally(() => {
        entry.flight = undefined;
      });
    await entry.flight;
    if (!failed && entry.pending) await this.flush(entry);
  }
  ensure(
    session: Session,
    teamId?: string,
    taskId?: string,
    instruction?: string,
  ): Promise<void> {
    const existing = this.entries.get(session.id);
    if (existing) {
      existing.session = session;
      return existing.launch;
    }
    this.connect();
    const listeners = this.listeners.get(session.id) ?? new Set<() => void>();
    this.listeners.set(session.id, listeners);
    const entry: Entry = {
      session,
      teamId,
      taskId,
      instruction,
      snapshot: { output: "", tail: "", state: "starting" },
      listeners,
      pending: "",
      launch: Promise.resolve(),
    };
    this.entries.set(session.id, entry);
    entry.listeners.forEach(listener => listener());
    registerTranscriptFlush(session.id, async () => {
      await this.flush(entry);
      if (entry.pending)
        throw new Error("Terminal transcript has not been saved yet.");
    });
    entry.launch = (async () => {
      const bridge = window.contextgit!;
      const command = session.agent ?? "shell";
      const check = await bridge.harnessCheck(command);
      if (!check.installed)
        throw new Error(`Install ${command} before starting this agent.`);
      const resumeKey = `contextgit:launched-session:${session.id}`;
      const resume =
        localStorage.getItem(resumeKey) === "1" &&
        session.role !== "orchestrator";
      const size = this.sizes.get(session.id) ?? {cols:100, rows:30};
      await bridge.ptyStart({
        id: ptyIdForSession(session.id),
        sessionId: session.id,
        command,
        model: session.model ?? undefined,
        resume,
        cols: size.cols,
        rows: size.rows,
        cwd: session.worktree_path ?? session.project_path ?? undefined,
        input: resume ? undefined : (instruction ?? session.task ?? undefined),
        env: {
          CONTEXTGIT_RUN: session.name,
          CONTEXTGIT_ROLE: session.role ?? "worker",
          ...(teamId ? { CONTEXTGIT_TEAM: teamId } : {}),
          ...(taskId ? { CONTEXTGIT_TASK: taskId } : {}),
          ...(session.project_path
            ? { CONTEXTGIT_REPO: `${session.project_path}/.contextgit` }
            : {}),
          ...(session.port ? { PORT: String(session.port) } : {}),
        },
      });
      // A mounted view can resize while harness discovery / ptyStart is in
      // flight. Reapply after creation so that resize can never be lost.
      const latestSize = this.sizes.get(session.id);
      if (latestSize) bridge.ptyResize(ptyIdForSession(session.id), latestSize.cols, latestSize.rows);
      localStorage.setItem(resumeKey, "1");
      if (entry.snapshot.state === "starting")
        entry.snapshot = { ...entry.snapshot, state: "running" };
      await projectApi(session.project_path ?? undefined).updateSession(
        session.id,
        { status: "running" },
      );
    })()
      .catch((cause) => {
        entry.snapshot = {
          ...entry.snapshot,
          state: "error",
          error: String(cause),
        };
      })
      .finally(() => entry.listeners.forEach((listener) => listener()));
    return entry.launch;
  }
  snapshot(id: string): RuntimeSnapshot {
    return this.entries.get(id)?.snapshot ?? EMPTY;
  }
  session(id: string) {
    return this.entries.get(id)?.session;
  }
  async restore(session: Session) {
    if (this.entries.has(session.id)) return;
    const listeners = this.listeners.get(session.id) ?? new Set<() => void>();
    this.listeners.set(session.id, listeners);
    const entry: Entry = {
      session,
      snapshot: { output: "", tail: "", state: "exited" },
      listeners,
      pending: "",
      launch: Promise.resolve(),
    };
    this.entries.set(session.id, entry);
    try {
      const detail = await projectApi(
        session.project_path ?? undefined,
      ).sessionDetail(session.id);
      const output = detail.terminal_transcript.slice(-180_000);
      entry.snapshot = {
        output,
        tail: readableTerminalOutput(output).slice(-1400),
        state: "exited",
      };
      this.outputListeners.get(session.id)?.forEach((listener) => listener(output));
    } catch (cause) {
      entry.snapshot = {
        ...entry.snapshot,
        error: `Saved output unavailable: ${String(cause)}`,
      };
    }
    listeners.forEach((listener) => listener());
  }
  async retry(id: string, teamId?: string, taskId?: string) {
    const pending = this.retries.get(id);
    if (pending) return pending;
    const entry = this.entries.get(id);
    if (!entry || ["starting", "running"].includes(entry.snapshot.state))
      return;
    entry.teamId = teamId ?? entry.teamId;
    entry.taskId = taskId ?? entry.taskId;
    const launch = (async () => {
      await this.flush(entry);
      this.entries.delete(id);
      await this.ensure(entry.session, entry.teamId, entry.taskId, entry.instruction);
    })().finally(() => this.retries.delete(id));
    this.retries.set(id, launch);
    return launch;
  }
  async checkpoint(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    await this.flush(entry);
    if (entry.pending)
      throw new Error(
        "The transcript could not be saved. Retry the checkpoint when the backend is available.",
      );
    const api = projectApi(entry.session.project_path ?? undefined);
    if (entry.session.agent === "opencode") await api.captureConversation(id);
    else if (entry.snapshot.tail.trim())
      await api.stage(id, [{ role: "tool", content: entry.snapshot.tail }]);
    if ((await api.staging(id)).length)
      await api.commitStaged(id, `checkpoint: ${entry.session.name}`);
  }
  subscribeOutput(id: string, listener: (data: string) => void) {
    const listeners = this.outputListeners.get(id) ?? new Set<(data: string) => void>();
    this.outputListeners.set(id, listeners);
    listeners.add(listener);
    const output = this.snapshot(id).output;
    if (output) listener(output);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.outputListeners.delete(id);
    };
  }
  subscribe(id: string, listener: () => void) {
    const listeners = this.listeners.get(id) ?? new Set<() => void>();
    this.listeners.set(id, listeners);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
  async send(id: string, text: string) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error("Start the agent before sending a command.");
    await entry.launch;
    if (entry.snapshot.state !== "running")
      throw new Error(entry.snapshot.error ?? "This agent has exited.");
    window.contextgit?.ptyWrite(ptyIdForSession(id), text);
  }
  resize(id: string, cols: number, rows: number) {
    this.sizes.set(id, {cols, rows});
    if (this.entries.get(id)?.snapshot.state === "running")
      window.contextgit?.ptyResize(ptyIdForSession(id), cols, rows);
  }
  async stop(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    await this.flush(entry);
    window.contextgit?.ptyKill(ptyIdForSession(id));
  }
}
const EMPTY: RuntimeSnapshot = { output: "", tail: "", state: "idle" };
export const terminalRuntime = new TerminalRuntime();
