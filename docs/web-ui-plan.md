# Web UI/UX plan (OpenHands-inspired)

ContextGit is now a local web app only (`contextgit web` → http://127.0.0.1:7417).
This plan replaces the floating-canvas-only UI with an OpenHands-style workbench,
keeping the canvas as one view for multi-agent teams. UI first, logic second.

## Audit: what is wrong today

- Everything floats on one infinite canvas: no fixed place for navigation, no
  "where am I" (active project, branch, agent state), terminals drift around.
- Top-right pill toolbar mixes actions (New agent, Create team) with panels
  (Files, Memory, Skills); panels overlap modals and Escape does not close them.
- The New agent dialog is taller than the viewport, so **Start agent is below the
  fold**, and it forgets the CLI you picked last time (reset Shell → Codex).
- The file viewer renders a Markdown `#` heading at ~80px and overflows.
- No home or empty state that helps you start: just "Open project".
- 64 unreachable files (~8.3k lines) from the old tabbed desktop UI still ship
  in `src/`, plus a 6k-line `shell.css` with many dead rules.

## Target layout

```
┌──┬──────────────────────────────────────────────────────────────┐
│◎ │ Session title · agent · ● running · project ▾ · branch       │  header
│＋├────────────────────────┬─────────────────────────────────────┤
│☰ │ Activity               │ [Terminal] [Files] [Changes] [App]  │
│⧉ │  task, status timeline │                                     │
│✦ │  checkpoints, messages │   live xterm / file viewer / diff   │
│▤ │                        │                                     │
│  │ ┌────────────────────┐ │                                     │
│⚙ │ │ Send to agent…   ⏎ │ │                                     │
│● │ └────────────────────┘ │                                     │
└──┴────────────────────────┴─────────────────────────────────────┘
 rail                       resizable split
```

- **Left rail (56px, icons + tooltips):** logo, New session (+), Sessions,
  Canvas (teams), Skills, Memory; bottom: Settings, backend status dot.
- **Sessions drawer:** list of agent sessions for the active project with
  status dots, grouped Running / Recent, project switcher at the top.
- **Home (no session selected):** centred "What do you want to build?" card:
  project chip (recent + Open folder), agent CLI chips (Shell, Codex, Claude
  Code, OpenCode…), run location (project root / new worktree), prompt box →
  **Start**. Recent sessions as cards below. Start is always visible.
- **Session view:** header with status + actions (stop, checkpoint, close);
  left Activity panel with a composer that writes into the agent's terminal;
  right Workspace tabs: Terminal (existing `EmbeddedTerminal`), Files (tree +
  viewer), Changes (git diff of the session's worktree/project), App (iframe
  of `session.port` when the agent serves something).
- **Canvas:** the existing `SpatialShell` mounted as a view, for teams.
- **Skills / Memory / Settings:** full-height pages in the main area with the
  same card/form styles, not overlapping popovers.

## Design system

`web/src/app/tokens.css` + `web/src/app/ui.tsx`: dark neutral surfaces
(OpenHands-like), ContextGit orange as the single accent, 8px spacing scale,
radius 8/12, Schibsted Grotesk for UI and JetBrains Mono for code, visible focus
rings, 150ms transitions, `prefers-reduced-motion` respected. Primitives:
Button, IconButton (with tooltip), Chip, Card, Tabs, StatusDot, EmptyState,
Sheet/Page header. Esc closes the top sheet; every icon button has a label.

## Phase 1: UI (parallel agents, disjoint files)

| Agent | Owns (new files) | Delivers |
|---|---|---|
| Rail & Home | `src/app/rail/*`, `src/app/home/*` | left rail, sessions drawer, home/start screen |
| Session | `src/app/session/*` | header, activity panel, composer |
| Workspace | `src/app/workspace/*` | Terminal / Files / Changes / App tabs, split view |
| Library | `src/app/library/*` | Skills, Memory, Settings pages |

The foundation (`src/app/tokens.css`, `src/app/ui.tsx`, `src/app/AppShell.tsx`,
`src/app/types.ts`) and wiring into `Shell.tsx` are done by the lead, not the
agents. Agents reuse existing hooks (`useWorkbenchState`, `terminalRuntime`,
`projectApi`) and do not edit files outside their folder.

## Phase 2: logic

- Delete the 64 unreachable files and dead CSS; split `shell.css`.
- Remember the last CLI / model / run location per project.
- Bookmarkable address: stop requiring the token in the URL (cookie handoff),
  so http://127.0.0.1:7417 always opens the app.
- Decode subprocess output as UTF-8 on Windows (crashes seen in the API log).
- Keyboard: Ctrl+K command palette, Ctrl+N new session, Esc closes sheets.

## Done means

`npm run typecheck` and `npm run build` pass; the app works end to end at
http://127.0.0.1:7417 on Windows: start a shell and an AI CLI from Home, type in
the terminal, browse files, see changes, open the canvas, edit skills.
