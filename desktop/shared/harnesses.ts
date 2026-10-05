/**
 * Canonical CLI harness registry, shared by the Electron main process (which
 * spawns the process) and the renderer (which draws the picker and brands it).
 *
 * `id` is triple-duty: the `Session.agent` value stored by the backend, the
 * PTY preset key, and the `data-agent` key for the monogram hue / brand mark.
 * Keep those three in lockstep — that is why this is one list, not three.
 */
export interface Harness {
  /** session.agent, PTY preset key, data-agent / CSS hue key. */
  id: string;
  label: string;
  /** Fallback glyph when no brand mark exists (also the Agent-tab avatar). */
  monogram: string;
  /** Command to run; `null` uses the user's default shell. */
  command: string | null;
  args: string[];
  /**
   * Global npm package installed on demand when the command is missing.
   * `null` opts the harness out of auto-install (its own installer / package
   * manager), leaving today's "spawn and let it report" behaviour in place.
   */
  npmPackage: string | null;
  /** Extra args passed to `npm install -g` (e.g. `["--ignore-scripts"]`). */
  installArgs?: string[];
  docsUrl?: string;
}

export const HARNESSES: Harness[] = [
  // Bundled-with-the-CLI tools that predate auto-install: `npmPackage` stays
  // null so their launch path is unchanged.
  { id: "claude", label: "Claude Code", monogram: "C", command: "claude", args: [], npmPackage: null },
  { id: "codex", label: "Codex", monogram: "X", command: "codex", args: [], npmPackage: null },
  { id: "opencode", label: "OpenCode", monogram: "O", command: "opencode", args: [], npmPackage: null },
  { id: "gemini", label: "Gemini CLI", monogram: "G", command: "gemini", args: [], npmPackage: null },
  { id: "aider", label: "Aider", monogram: "A", command: "aider", args: [], npmPackage: null },
  { id: "ollama", label: "Ollama", monogram: "L", command: "ollama", args: ["run"], npmPackage: null },
  { id: "shell", label: "Shell", monogram: "$", command: null, args: [], npmPackage: null },
  // Auto-installable harnesses (one hidden `npm install -g` away).
  {
    id: "freebuff",
    label: "Freebuff",
    monogram: "F",
    command: "freebuff",
    args: [],
    npmPackage: "freebuff",
    docsUrl: "https://freebuff.com/cli",
  },
  {
    id: "cline",
    label: "Cline",
    monogram: "L",
    command: "cline",
    args: [],
    npmPackage: "cline",
    docsUrl: "https://cline.bot/cli",
  },
  {
    id: "pi",
    label: "Pi",
    monogram: "π",
    command: "pi",
    args: [],
    npmPackage: "@earendil-works/pi-coding-agent",
    installArgs: ["--ignore-scripts"],
    docsUrl: "https://pi.dev/docs/latest/quickstart",
  },
  {
    id: "kilo",
    label: "Kilo Code",
    monogram: "K",
    command: "kilo",
    args: [],
    npmPackage: "@kilocode/cli",
    docsUrl: "https://kilo.ai/docs/code-with-ai/platforms/cli",
  },
  {
    id: "commandcode",
    label: "Command Code",
    monogram: "⌘",
    command: "command-code",
    args: [],
    npmPackage: "command-code",
    docsUrl: "https://commandcode.ai",
  },
];

export const HARNESS_BY_ID: Record<string, Harness> = Object.fromEntries(
  HARNESSES.map((harness) => [harness.id, harness]),
);

/** Look up a harness by id, PTY preset key or raw command. */
export function harnessFor(key: string | null | undefined): Harness | undefined {
  if (!key) return undefined;
  return HARNESS_BY_ID[key] ?? HARNESSES.find((entry) => entry.command === key);
}

export const DEFAULT_HARNESS = "claude";

/** Result of asking the main process whether a harness binary is on PATH. */
export interface HarnessCheck {
  id: string;
  command: string;
  installed: boolean;
  /** Resolved absolute path when found. */
  path: string | null;
}

export type HarnessInstallPhase = "checking" | "installing" | "verifying" | "done" | "error";

/** Progress pushed from the main process while a harness is being installed. */
export interface HarnessInstallEvent {
  id: string;
  phase: HarnessInstallPhase;
  /** Latest installer status line, shown under the progress bar. */
  line?: string;
  /** Coarse completion (0..1); the renderer animates between milestones. */
  percent?: number;
  /** Resolved command path once the install verifies. */
  path?: string;
  /** Present on `phase: "error"`. */
  error?: string;
}
