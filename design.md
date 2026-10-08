# ContextGit — UI design plan

**Prepared:** 2026-10-08
**Scope:** the desktop workbench (`desktop/src/shell*`, `desktop/src/shell.css`) and the landing
site (`app/globals.css`, `app/page.tsx`). This is a research and plan document. It does not change code.
**Companions:** `content.md` (what the product says), `pages.md` (which marketing pages exist).

---

## 1. What we have today

### 1.1 Design system (as scanned)

| Area | Desktop workbench (`desktop/src/shell.css`) | Landing (`app/globals.css`) |
|---|---|---|
| Direction | Dark-first "agent workspace", warm charcoal, scoped to `.cg-shell` | "Flight deck for a fleet": warm instrument panel, border-led, signal orange |
| Surfaces | `--cg-bg #191612`, `--cg-surface #211d18`, 2 more raised steps | `--paper` oklch(0.155), `--paper-lift`, `--paper-deep` |
| Text | `--cg-ink`, `--cg-ink-2`, `--cg-ink-3` | `--ink`, `--ink-2`, `--ink-3` |
| Accent | `--cg-signal #ff6a3d` (action only) | `--signal` oklch(0.68 0.19 42) |
| Status | `--cg-ok`, `--cg-warn`, `--cg-bad` | `--st-running / blocked / merged / error / idle`, always paired with a shape or label |
| Agent identity | 12 per-agent hues + brand marks (`--cg-agent-*`, `--cg-brand-*`) | — |
| Themes | Dark default; light set via `[data-cg-theme="light"]` | Dark default; light authored separately |
| Type | Schibsted Grotesk (UI), Martian Mono (labels/code) | same |
| Layout | Grid `rail | main | dock`, rail 17rem, dock 20rem, tabbed top nav | single long page with a section rail |
| Motion | `--cg-ease` cubic-bezier(0.16, 1, 0.3, 1) | `--ease` same curve |

**Strengths to keep:** a coherent warm palette; status never relies on colour alone; a real
dark/light split instead of an inversion; per-agent identity with monograms; a live terminal canvas.

**Weaknesses we can see from the code and the product description:**
- The shell is a **tab-based** layout (Chat, Code, Assets, Browser, Editor, API, Endpoints, Why, Database, Agent, Git).
  Users switch tabs to see a second thing. Competitors show several things at once (see §2).
- No **persistent multi-pane canvas**. Browser, editor, and API run as separate tabs, so "one window"
  feels like ten apps behind a switcher. This is the exact pain the product exists to remove.
- **The shell CSS is large** (about 5,260 lines in `shell.css`). Tokens exist, but many components
  are styled per screen. Consolidate before adding new surfaces.
- The landing page is **long** (ten sections, a ten-item section nav, a duplicated rail + header nav).
  Competitor landing pages are shorter and lead with a live product demo.
- No **onboarding or empty states** that show the first action. Competitors lead with "create a
  workspace / new terminal".

---

## 2. Competitor UI research

Sources were read on 2026-10-08. Marketing copy describes what the product claims. Where we say
"they show", we mean their own page shows it; we have not used the apps ourselves.

### 2.1 Conductor (conductor.build) — Mac

- **Pitch:** "Run parallel coding agents on your Mac." Claude Code, Codex and Cursor agents in isolated workspaces;
  see what each is doing, then review and merge.
- **UI pattern:** one list of parallel workspaces, each with its own status; a review-and-merge step per workspace.
- **Takeaway for us:** the "list of agents with status, then review" model matches our Code tab and Fleet view.
  Conductor is Mac-only; we ship Mac, Windows and Linux, so this is a differentiator to state.

### 2.2 Superset (superset.sh) — desktop + mobile + CLI

The strongest UI reference in this set. Their home page is a live product demo with these parts:

- **Left rail:** a workspace list grouped by host (`desktop`, `cloud`, `mobile`, `cli`), each row with a spinner
  or check, a branch name, and `+lines −lines` change counts.
- **Main pane:** a real agent terminal (Claude Code) with a "finished · worked for 7s" line and a
  next-step prompt box at the bottom.
- **Right pane (Changes/Review):** a file list with per-file `+/−` counts and an inline diff, plus a
  "Review" button next to the changes.
- **Automations tab:** a table of scheduled agents (name, schedule, last run, status) that open PRs for review.
- **Status board:** a grid of cards (Generating / Ready for Review) with per-card change counts.
- **Isolation card:** shows a diff inside a worktree, so "no overwriting" is shown, not just claimed.
- **Trust strip:** named engineers' quotes; "Private by default" and "Local first" as two short statements.
- **Agent picker:** a grid of 12+ agent names in a "new terminal" menu.

Takeaways:
1. The **three-column workspace** (rail · terminal · changes) is the picture of "many agents, one window".
2. **Per-workspace change counts** (`+46 −1`) in the rail make status scannable.
3. **Review sits beside the terminal**, so the agent and the diff are one view.
4. Put **automations** in the product UI, not only in docs.

### 2.3 BridgeMind (bridgemind.ai) — Mac, Windows, Linux

Closest to our "one window with a toolbox" idea. Their UI has three modes switched from the title bar:

- **Agent:** teammates on routines; named agents with a brief and a schedule.
- **Code:** a stacked pane canvas (split, snap, dock) of live terminals, with a browser on `localhost:3000`
  docked beside them and a "Dashboard" of running agents.
- **Thread:** each coding session as a readable conversation, with approvals.

Other patterns on their page:
- **Accounts switcher:** several Claude/Codex accounts, a default per conversation, and "a limit pauses; you choose".
- **Voice input** (BridgeVoice) with a live demo.
- **Preview block:** a stylised screenshot of the app with a "Preview, interactive" note.

Takeaways:
1. A **mode switch in the title bar** (Agent / Code / Thread) changes the whole app without losing place. This maps well
   to our existing `TopNav` segmented tabs. We can add modes without adding more top-level tabs.
2. **Split, snap and dock** are the expected UI for parallel agents. Our `WebViewPanel` plan (see
   `files/workspace-architecture.md`) is the same idea.
3. **"A limit pauses. You choose."** Show usage limits as a decision, not an error. We already have
   harness limits (`files/code-harness-limits.md`); surface them this way.

### 2.4 Vibe Kanban (vibekanban.com) — open source, 28k+ GitHub stars (per their page)

- **Pitch:** "The best way to run parallel coding agents." Plan → Prompt → Review, as a kanban of issues and sub-issues.
- **UI pattern:** a board (kanban) that moves a task from plan to review; each agent runs in a worktree
  with a dev-server preview and inline comments on AI-generated code.
- **Takeaways:**
  1. Our **Team tab** (tasks with roles, dependencies, a board) follows this pattern. Make the board the
     default Team view, with the columns the team already uses: `blocked · ready · running · review · done`.
  2. **Inline comments on the diff** are missing from our Review flow. Add them in the Changes/Review pane.
  3. The page sells a **"review bottleneck"**. This matches our verifier and quality gate; make the
     review step visible in the UI, not hidden in a dialog.

### 2.5 1DevTool (1devtool.com) — the toolbox competitor

- **Pitch on the home page:** "One window for Claude Code, Codex, Grok and 12 more — with the editor, browser,
  database, git and tasks they reach for."
- **Profiles:** each project or tab can have its own login (`Switch a tab's login from the toolbar`); agents
  inherit the profile.
- **Layout:** "Drag panels and save layout presets per project" (Pro). Free allows 1 project, 4 terminals, 1 browser tab.
- **Takeaways:**
  1. **Per-project layout presets** and **project groups** are a clear feature we can match.
  2. **Profiles per tab** (logins) are an area we don't cover; check whether it's worth it for the browser.
  3. Their free tier is capped by **counts** (projects, terminals, tabs). Our free tier is planned without caps
     (`content.md` §7). Show that difference in the UI: no "upgrade" badges on normal counts.

### 2.6 Cross-competitor patterns (what everyone does)

| Pattern | Conductor | Superset | BridgeMind | Vibe Kanban | 1DevTool | ContextGit today |
|---|---|---|---|---|---|---|
| Parallel agent list with status | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (Code tab, fleet) |
| Live terminal in the main pane | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Diff/review next to the terminal | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ (dialog, not beside) |
| Change counts (`+/−`) in rail | — | ✓ | — | — | — | ✗ |
| Split/snap/dock multi-pane canvas | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ (planned, `workspace-architecture.md`) |
| Board for tasks | — | — | — | ✓ | — | partial (Team tab) |
| Mode switch in title bar | — | — | ✓ | — | — | ✗ (tabs only) |
| Scheduled agents / automations | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ (Agent tab fixtures) |
| Embedded browser | ✗ | ✗ | ✓ | ✓ (preview) | ✓ | ✓ |
| Embedded DB / API clients | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ |
| Versioned AI context / merge | ✗ | ✗ | ✗ | ✗ | ✗ | **✓ (the differentiator)** |

**The gap to exploit:** we are the only one with versioned, mergeable context. None of the four shows
it in the UI. The design job is to make **branches of context visible next to the diff**, so the
differentiator is seen, not only read about.

---

## 3. Design principles (for the UI change)

1. **Several things at once.** Replace "one tab at a time" with a pane canvas for the core loop
   (agent · diff · browser · DB/API). Keep tabs for secondary surfaces.
2. **Agent and review side by side.** Every run shows its terminal and its changes together.
3. **Status is always labelled.** Keep the shape-plus-text rule from `globals.css`.
4. **Counts are information, not upsell.** No plan badges on normal limits (see §2.5).
5. **Make the context branch visible.** The commit graph and merge preview sit next to the run they came from.
6. **Shrink before adding.** Consolidate the shell CSS and the landing sections before adding new surfaces.

---

## 4. Proposed UI changes

### 4.1 Workbench (desktop)

| # | Change | Why (from research) | Notes |
|---|---|---|---|
| W1 | **Title-bar mode switch**: Agent · Code · Thread (or our names) | BridgeMind. Changes the whole app without adding tabs | Reuse `TopNav` segmented control; add a mode, not a tab |
| W2 | **Three-column Code view**: runs rail · terminal · changes | Superset | Rail rows get `+lines −lines` and status label |
| W3 | **Review pane beside the terminal** with inline comments | Superset, Vibe Kanban | Reuse the existing diff sheet (`shell/git/DiffSheet.tsx`) |
| W4 | **Split/snap/dock canvas** for the core loop | BridgeMind, 1DevTool | Already designed in `files/workspace-architecture.md` (F1); this doc only sets the visual rules |
| W5 | **Team board as default** (blocked · ready · running · review · done) | Vibe Kanban | Team tab already has a board; make it the default view |
| W6 | **Per-project layout presets** | 1DevTool | Store in the existing project settings; matches `files/multi-project.md` |
| W7 | **Limit as a decision** ("paused · resume or switch account") | BridgeMind | Uses `files/code-harness-limits.md` data |
| W8 | **Empty states with one first action** ("New run", "Open a repo") | Superset onboarding | Each empty surface: one line, one button |
| W9 | **Context branch chip on each run** linking to its commit graph | our differentiator | Show the branch name the run is on, and open the graph on click |

### 4.2 Landing site (web)

| # | Change | Why | Notes |
|---|---|---|---|
| L1 | **Hero shows the workbench**: one live screenshot or interactive mock with three columns (runs · terminal · changes) | Superset, BridgeMind | Replace the commit-graph-first hero |
| L2 | **Cut the long page**: keep Hero, Parallel runs, Versioned context, Pricing, FAQ, CTA; move the CLI workflow to `/features` | Competitor pages are short | See `pages.md` §2.1 |
| L3 | **One header nav, not two**: remove the duplicated section rail on mobile | Less noise | Keep the rail for desktop only |
| L4 | **Trust strip** with "Local first" and "Your agents, your accounts" | Superset, BridgeMind | Copy from `content.md` §10 |
| L5 | **Shorter nav** (six items or fewer) | `pages.md` §1 | Already planned |
| L6 | **Comparison section** linking to `/compare/1devtool` | 1DevTool is the named competitor | Keep it factual |

### 4.3 Shared system

| # | Change | Notes |
|---|---|---|
| S1 | Document the tokens in one place (this file §1.1) and use only `--cg-*` (workbench) and the landing tokens. Remove one-off hex values | Reduces drift between light and dark |
| S2 | Consolidate `shell.css` into component-level files as surfaces are touched (not all at once) | 5,260 lines is too much to change safely in one pass |
| S3 | Keep the light theme authored separately (no inversion) | Matches the current rule |
| S4 | Add a small component set: `PaneHeader`, `StatusChip` (shape + label), `CountBadge` (`+/−`), `EmptyState` | Used by W2, W5, W8 |

---

## 5. Phased plan

| Phase | Scope | Exit check |
|---|---|---|
| **U0 — Audit** | Screenshot every tab and the landing page in dark and light; list every hard-coded colour and each duplicated nav | List committed to `files/ui-audit.md` (new) |
| **U1 — Tokens and components** | S1, S4; no visual change yet | Dark and light screenshots identical before/after |
| **U2 — Code view** | W2, W3, W9 | A run shows terminal and changes together; keyboard reachable |
| **U3 — Modes and boards** | W1, W5, W8 | Switching modes keeps the open run; Team board is default |
| **U4 — Canvas** | W4, W6 (depends on the F1 canvas plan in `workspace-architecture.md`) | Panels persist across relaunch; layout presets save |
| **U5 — Landing** | L1–L6 | Lighthouse performance and accessibility not lower than the current site (measure before and after) |
| **U6 — Polish** | W7, empty-state copy, motion review | No new motion without a reduced-motion check |

**Verification standard for every phase** (from `files/desktop.md`): `cd desktop && npm run build`,
root `npx tsc --noEmit`, `.venv/bin/pytest -q`, and the Playwright e2e suite. Add screenshot diffs for U1
and U5. Measure, don't assume, on any performance claim.

---

## 6. Accessibility and quality rules

- Keyboard reachable for every pane, tab and mode. Visible focus (`--cg-focus`).
- Status uses a shape or text label, never colour alone (existing rule).
- Respect `prefers-reduced-motion` for the canvas and status animations.
- Contrast: check `--cg-ink-3` on `--cg-surface-2` before using it for any required text.
- Diff colours (`+` / `−`) keep the sign, not colour alone.

---

## 7. Open questions for the founder

1. Mode names: **Agent · Code · Thread** (like BridgeMind), or our own names?
2. Should the Code view default to three columns, or keep the current tab layout as the first step?
3. Do we want a **live interactive preview** on the landing hero (like Superset and BridgeMind), or a static screenshot?
4. Brand: stay with the warm-charcoal + signal-orange look, or move closer to the competitors' neutral dark?
5. Do we want **automations** (scheduled agents) as a visible surface, given Superset and BridgeMind both lead with it?

---

## 8. Sources

- [Conductor](https://www.conductor.build/) — read 2026-10-08
- [Superset](https://superset.sh/) — read 2026-10-08
- [BridgeMind](https://www.bridgemind.ai/) — read 2026-10-08
- [Vibe Kanban](https://www.vibekanban.com/) — read 2026-10-08
- [1DevTool](https://1devtool.com/) and [1DevTool pricing](https://1devtool.com/pricing) — read 2026-10-08
- Repo: `desktop/src/shell.css`, `app/globals.css`, `files/workspace-architecture.md`, `files/desktop.md`,
  `files/code-harness-limits.md`, `files/multi-project.md`, `files/all-in-one-landscape.md`

**Caveat:** competitor claims are their own marketing. Their star counts, user numbers and quotes are not verified.
We did not run their apps. Before a public comparison, install each one and confirm the UI features listed here.
