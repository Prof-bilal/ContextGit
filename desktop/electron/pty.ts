/**
 * PTY manager: one node-pty process per terminal session. Output is pushed
 * to the renderer over `ctx:pty-data`; input/resize/kill come back over IPC.
 */
import { type IPty, spawn } from "node-pty";

import { HARNESSES } from "../shared/harnesses";

export interface PtyPreset {
  /** Command to run; `null` uses the user's default shell. */
  command: string | null;
  args: string[];
}

/** CLI presets shown in the "New session" picker. Any command can be typed too. */
export const PTY_PRESETS: Record<string, PtyPreset> = Object.fromEntries(
  HARNESSES.map((harness) => [harness.id, { command: harness.command, args: harness.args }]),
);

export interface PtyStartOptions {
  id: string;
  /** Preset name or a raw command; shell when empty/"shell". */
  command: string;
  cwd: string;
  cols: number;
  rows: number;
  env: Record<string, string>;
  /**
   * One line typed into the terminal once it is up (team mode's briefing).
   * Sent on the first output, with a timeout fallback so a silent TUI still
   * receives it.
   */
  input?: string;
  /** Launch-scoped observer flags, separate from the shared CLI preset. */
  extraArgs?: string[];
}

export class PtyManager {
  private readonly _ptys = new Map<string, IPty>();
  private readonly _onData: (id: string, data: string) => void;
  private readonly _onExit: (id: string, code: number | undefined) => void;

  constructor(onData: (id: string, data: string) => void, onExit: (id: string, code: number | undefined) => void) {
    this._onData = onData;
    this._onExit = onExit;
  }

  start(options: PtyStartOptions): void {
    this.kill(options.id); // replace any stale pty for the same id
    const preset = PTY_PRESETS[options.command];
    const command = options.command === "" || options.command === "shell"
      ? null
      : preset?.command ?? options.command;
    const taskPrompt = options.command === "opencode" ? options.input?.trim() : undefined;
    const args = taskPrompt
      ? [...(preset?.args ?? []), ...(options.extraArgs ?? []), "run", taskPrompt]
      : [...(preset?.args ?? []), ...(options.extraArgs ?? [])];
    const pty = spawn(command ?? defaultShell(), args, {
      name: "xterm-256color",
      cols: Math.max(20, options.cols),
      rows: Math.max(5, options.rows),
      cwd: options.cwd,
      env: { ...process.env, ...options.env } as Record<string, string>,
    });
    pty.onData((data) => this._onData(options.id, data));
    // Team OpenCode sessions use `opencode run` above, so they submit the task
    // as a CLI argument. Other harnesses keep the interactive initial-input
    // path because their command-line prompt interfaces differ.
    if (!taskPrompt && options.input && options.input.trim()) {
      const payload = `${options.input.trim()}\r`;
      let sent = false;
      let inputTimer: ReturnType<typeof setTimeout> | null = null;
      let submitTimer: ReturnType<typeof setTimeout> | null = null;
      const send = () => {
        if (sent) return;
        sent = true;
        if (inputTimer !== null) clearTimeout(inputTimer);
        try {
          // OpenCode can render the prompt while it is still wiring its input
          // handler. Type the brief first, then submit it as a separate key so
          // the Enter event cannot be swallowed during startup.
          pty.write(payload.slice(0, -1));
          submitTimer = setTimeout(() => {
            try {
              pty.write("\r");
            } catch {
              // the process already exited
            }
          }, 250);
        } catch {
          // the process already exited
        }
      };
      const scheduleAfterPaint = () => {
        if (sent) return;
        if (inputTimer !== null) clearTimeout(inputTimer);
        // Sending on the first output can race OpenCode's prompt and silently
        // drop the task brief. Wait for the TUI's first paint to go quiet.
        inputTimer = setTimeout(send, 700);
      };
      pty.onData(scheduleAfterPaint);
      // Slow-starting CLIs may not produce a quiet first paint; keep a bounded
      // fallback so the task is still submitted without waiting forever.
      inputTimer = setTimeout(send, 3000);
      pty.onExit(() => {
        if (inputTimer !== null) clearTimeout(inputTimer);
        if (submitTimer !== null) clearTimeout(submitTimer);
      });
    }
    pty.onExit(({ exitCode }) => {
      if (this._ptys.get(options.id) === pty) this._ptys.delete(options.id);
      this._onExit(options.id, exitCode);
    });
    this._ptys.set(options.id, pty);
  }

  write(id: string, data: string): void {
    this._ptys.get(id)?.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const pty = this._ptys.get(id);
    if (pty && cols >= 20 && rows >= 5) pty.resize(cols, rows);
  }

  kill(id: string): void {
    const pty = this._ptys.get(id);
    if (pty) {
      try {
        pty.kill();
      } catch {
        // already exited
      }
      this._ptys.delete(id);
    }
  }

  killAll(): void {
    for (const id of [...this._ptys.keys()]) this.kill(id);
  }

  has(id: string): boolean {
    return this._ptys.has(id);
  }
}

function defaultShell(): string {
  return process.env.SHELL ?? (process.platform === "win32" ? "powershell.exe" : "/bin/bash");
}
