# Code tab: CLI harnesses

The Code tab runs a **CLI harness** per terminal/run. A harness is an agent CLI
(`claude`, `codex`, `gemini`, `cline`, …) launched as a PTY in that run's
worktree. This doc covers the harness registry, the auto-install path, and how
to add a harness.

## One registry

Harness metadata used to be spread across `agents.ts` (id/label/monogram),
`pty.ts` (command/args), `primitives.tsx` (icon/colour) and CSS. It now has a
single source of truth:

| Concern | Where |
|---|---|
| **The list** — id, label, monogram, command, args, npm package, docs | `desktop/shared/harnesses.ts` (`HARNESSES`) |
| PTY presets (derived) | `desktop/electron/pty.ts` (`PTY_PRESETS`) |
| UI list + labels (derived) | `desktop/src/shell/agents.ts` |
| Brand mark + colour | `desktop/src/shell/primitives.tsx` (`MARKS`, `MARK_COLORS`) + `desktop/src/shell/marks/brand.tsx` |
| Brand hue / avatar colour | `desktop/src/shell.css` (`--cg-brand-*`, `--cg-agent-*`) |

`id` is triple-duty: the `Session.agent` value stored by the backend, the PTY
preset key, and the `data-agent` / brand-mark key. That is *why* it is one list.

```ts
interface Harness {
  id: string;                 // session.agent · PTY preset · data-agent
  label: string;
  monogram: string;           // fallback glyph / Agent-tab avatar hue
  command: string | null;     // null = the user's default shell
  args: string[];
  npmPackage: string | null;  // global install; null = no auto-install
  installArgs?: string[];     // e.g. pi's ["--ignore-scripts"]
  docsUrl?: string;
}
```

## The harnesses

| id | Label | Command | Install |
|---|---|---|---|
| `claude` | Claude Code | `claude` | — (already on PATH) |
| `codex` | Codex | `codex` | — |
| `opencode` | OpenCode | `opencode` | — |
| `gemini` | Gemini CLI | `gemini` | — |
| `aider` | Aider | `aider` | — |
| `ollama` | Ollama | `ollama run` | — |
| `shell` | Shell | *(default shell)* | — |
| `freebuff` | Freebuff | `freebuff` | `npm i -g freebuff` |
| `cline` | Cline | `cline` | `npm i -g cline` |
| `pi` | Pi | `pi` | `npm i -g --ignore-scripts @earendil-works/pi-coding-agent` |
| `kilo` | Kilo Code | `kilo` | `npm i -g @kilocode/cli` |
| `commandcode` | Command Code | `command-code` | `npm i -g command-code` |

The first seven are unchanged and carry `npmPackage: null`, so their launch path
is exactly as before. The five new ones auto-install on demand.

Brand marks: `cline` uses Simple Icons (`SiCline`); the other four ship official
vectors in `marks/brand.tsx` (freebuff.com, pi.dev, Kilo-Org/kilocode,
commandcode.ai).

## Detection + hidden install

There is **no installer terminal**. When a run starts:

1. `TerminalPane` renders `<HarnessInstall>` instead of the terminal for any
   harness with an `npmPackage`.
2. The renderer asks the main process `ctx:harness-check`. The main process
   scans PATH (via `augmentedPath()`, which merges `~/.local/bin`, mise shims,
   the live npm global prefix, Homebrew, … so a GUI-launched Electron finds
   CLIs). Installed → start the PTY immediately.
3. Missing → `ctx:harness-install` runs `npm install -g <pkg>` as a **plain
   child process** (not a PTY). Output lines stream back over
   `ctx:harness-progress`; the renderer draws a progress bar, the latest npm
   line, and a Cancel button.
4. On success it re-checks PATH, then starts the PTY. On failure it shows the
   error, a Retry button and the exact install command.

The same gate applies in **Team mode**, because team runs spawn panes through the
same `TerminalPane`.

IPC surface (main ↔ renderer): `ctx:harness-check`, `ctx:harness-install`,
`ctx:harness-cancel`, and the `ctx:harness-progress` push. Types live in
`desktop/shared/harnesses.ts` (`HarnessCheck`, `HarnessInstallEvent`).

## Backend parity

The backend stores the chosen harness as an opaque `Session.agent` string, so
the new ids flow through sessions, team tasks and the `AGENTS.md` block with no
backend change. The only backend tie-in is the independent-verifier preference
list (`contextgit/core/repo.py`, `_VERIFIER_AGENTS`), which includes the new
ids so any of them can implement and be reviewed by a different agent.

## Adding a harness

1. Add one row to `HARNESSES` in `desktop/shared/harnesses.ts`.
2. Add its brand mark to `MARKS` / `MARK_COLORS` in `primitives.tsx` (see
   `marks/brand.tsx`) and the `--cg-brand-*` / `--cg-agent-*` tokens in
   `shell.css`.
3. Add the id to `_VERIFIER_AGENTS` in `repo.py` if it should be verifier-eligible.

Everything else (picker, PTY preset, rail grouping, avatar hue) derives.
