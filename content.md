# ContextGit — website content brief

**Prepared:** 2026-10-08
**Purpose:** a single source of truth for what the website should say. Built from a scan of the
repo (`README.md`, `files/*.md`, `desktop/`, `contextgit/`, `app/`, `components/`) and one
competitor pass (1DevTool, verified on its own pricing page on 2026-10-08).
**Companion:** `pages.md` — the list of marketing pages and what each one contains.

---

## 1. What the product is (one paragraph)

ContextGit is a **single desktop workbench for building software with AI agents**. It puts the
tools a developer otherwise opens as separate apps — coding agents, terminals, a code editor, a
browser, an API client, a database client, git — into **one native window**, and it versions the
AI conversations behind the work the same way git versions the code. Each agent run gets its own
git worktree, so parallel agents never overwrite each other. Conversations are stored as
immutable, branchable commits, and branches can be merged as summaries after a conflict check.
It is local-first: one SQLite file on your machine, and only the model calls leave it.

**Shorter (for meta description / hero sub-line):**
> One window for your agents, editor, browser, API and database clients — with version-controlled
> AI context you can branch and merge.

---

## 2. The problem, in the user's words

The scanned pain (from the project's own `files/all-in-one-landscape.md`):

- A working developer touches a dozen apps a day: editor, several terminals, an API client,
  a database tool, a browser with DevTools, Docker, and now several AI agent CLIs.
- Every alt-tab costs focus. Over a day this adds up to 30–60 minutes lost to navigation.
- Running many apps and many agents at once makes the machine slow. (The user's own report:
  "if the user opens multiple apps the PC hangs.") **Note:** this is the founder's stated motivation.
  Do **not** publish a performance claim (e.g. "uses 60% less RAM") until it is measured.
- AI conversations are a single scroll. One wrong turn poisons the next fifty steps; a dead end
  costs the whole context.

---

## 3. Who it is for

| Persona | What they do today | What ContextGit gives them |
|---|---|---|
| **Solo developer running AI agents** | Several agent CLIs in separate terminals, plus an editor, Postman, a DB tool | One window, one board, every run isolated |
| **Developer doing agentic coding** | One long agent session that goes off the rails | Branch the context before the bad turn; merge only what was learned |
| **Team lead / reviewer** (later) | Hand-tracking who touches which file | Claims, scopes, verifier runs, a merge queue |
| **Researcher / prompt author** | A/B tests a prompt by losing their place | Compare branches side by side; chat, council and research modes |

---

## 4. Feature inventory (what is real today)

Grouped for the website. Each line is backed by the repo (README, `desktop/`, `contextgit/`).
"Shipped" = in the code and documented. Nothing here is a promise about a future release.

### 4.1 One window (the all-in-one workbench)
- **Terminal board** — live terminals (xterm + node-pty) per run.
- **Code tab** — parallel runs, one terminal and one git branch each.
- **Editor** — embedded VS Code (bundled `code-server` sidecar) with a ContextGit graph.
- **Browser** — general-purpose in-app browser: tabs, history, bookmarks, find-in-page, zoom, DevTools.
- **API client** — embedded Restfox sidecar; native runner is the default.
- **Database** — embedded DbGate sidecar (MySQL, Postgres, SQL Server, MongoDB, Redis, SQLite, ClickHouse and more).
- **Assets** — file-asset library with an AI agent.
- **Git** — history, graph, diffs, merge preview.
- **Chat / Docs / Usage** — chat turns, document generation (Markdown, PDF, Word, PowerPoint), token-usage view.
- **Why / Endpoints / Agent** tabs — visible in the app; check before advertising (see §9).

### 4.2 Agents
- **11 agent CLIs with real brand icons** — Claude Code, Codex, OpenCode, Gemini CLI, Aider,
  Ollama, Freebuff, Cline, Pi, Kilo Code, Command Code — plus a plain Shell.
- **Auto-install on demand** — a missing CLI is installed in the background with a progress bar; no installer terminal.
- **Harness usage limits** — each CLI's own account limits shown in the Code tab, read locally.
- **Chat providers** — bring your own key; any OpenAI-compatible endpoint (`CTX_LLM_API_KEY`, `CTX_LLM_BASE_URL`, `CTX_LLM_MODEL`).

### 4.3 Parallel runs without collisions
- **One git worktree + branch per run** — agents edit isolated checkouts.
- **Fleet visibility** — changed files, ahead/behind, conflict verdict, file overlap between runs.
- **Claims** — each run claims its paths; overlaps are flagged; a managed `AGENTS.md` block tells agents who owns what.
- **Merge queue** — sequential, checkout-free integration with a `git merge-tree` pre-flight; a conflict stops the queue.
- **Paired merge** — merging a run lands its diff on the git branch *and* its reasoning on the context branch.
- **Run isolation** — a private local port per run and a work-in-progress cap.

### 4.4 Team mode
- A mission split into tasks with **roles, file scopes and dependencies**.
- One run and worktree per task; **blocked** tasks wait for their dependencies.
- **Enforced ownership** — two tasks can never claim the same files (refused before anything is created).
- **Quality gate** — finishing a task runs the project's own test/lint command; red sends it back with the output.
- **Independent verifier** — a read-only review by a different agent CLI, from its own worktree.
- **MCP channel** — `contextgit-mcp` exposes the board as MCP tools; `.mcp.json` is written on launch.

### 4.5 Conversation version control (the core)
- **Conversation DAG** — immutable, content-addressed (SHA-256) commits over messages.
- **Branch, tag, checkout, log, diff, rollback** — later commits are never destroyed.
- **Branch from any message**; **chat sessions** are isolated and forked from the root.
- **Staged turns** — nothing lands on the branch until **Commit**; a pending-changes diff shows exactly what will land.
- **Semantic merge** — extracts decisions, facts, dead ends and open questions; detects contradictions;
  **never auto-resolves a conflict**; shows a preview before anything is written.
- **Merge quality probes** — fixed probe questions check what a merge kept (an eval, not a promise).
- **Dead-end notes** — failed attempts survive as a few lines of context.

### 4.6 Privacy and data
- **Local-first** — one SQLite file, no account to start, no cloud.
- **Only model calls leave the machine**, and only to the provider you configured.
- **Apache-2.0** open source.
- **Local API** binds to localhost and has no authentication — do not expose it. (The website should not overclaim security here.)

---

## 5. Positioning and differentiators

**Category:** the all-in-one AI development workbench (desktop).

**Positioning line:**
> The one window where you build — editor, browser, API and database clients, and your agents —
> on top of version-controlled, mergeable AI context.

**What ContextGit has that the closest competitor does not (per the repo's own research and the 1DevTool pages reviewed):**
1. **Versioned, mergeable AI context.** Commits, branches, diffs and semantic merges for conversations.
   1DevTool has an AI memory feature but not immutable commits or semantic merge.
2. **Isolation by design.** One worktree per run, file claims, and a structural refusal of overlapping tasks.
3. **Independent verification and a quality gate** before work merges.
4. **Open source (Apache-2.0) and local-first**, with no per-seat fee for the local app (see §7).

**What the competitor does better today (be honest):**
- Ships **today** as a polished, signed product with installers and a full support story.
- Has a **proven price point** ($29 one-time) and a **free tier** people can try.
- Covers **Docker**, a **design canvas**, **SSH/SFTP**, and a **19+ utilities toolbox**. ContextGit does not
  (Docker and utilities are listed as "later" in `files/all-in-one-landscape.md`).
- Has **15 database engines** claimed on its pricing page. ContextGit has its DbGate embed; do not claim a
  number unless we verify it in the bundled client.

---

## 6. Competitor research

### 6.1 Primary competitor: 1DevTool

Verified on **1devtool.com** and **1devtool.com/pricing** on 2026-10-08.

| Aspect | 1DevTool (as stated on its site) |
|---|---|
| Shape | Desktop "one window" workspace for AI coding agents |
| Headline | "The Only Dev Tool You Need in the AI Era" |
| Agents | Claude Code, Codex, Gemini CLI, Aider, Grok and "12 more"; "Bring your own coding CLI" |
| Tools in one window | AI code editor, multi-agent terminals, built-in browser with DevTools, HTTP client, database client (15 engines), Docker manager, git client with visual diff, SSH/SFTP, 19+ utilities, design canvas, markdown editor |
| Free tier | $0 forever. 1 project, 4 terminals, 1 browser tab, 1 git worktree, 1 DB connection, 5 saved HTTP requests, 5 AI diffs/day, 7-day prompt history |
| Paid | One-time purchase, no subscription: **1 device $29**, **3 devices $59** ("most popular"), **5 devices $89**. Unlimited projects, terminals, DB connections, worktrees, AI diffs, prompt history |
| Updates | 12 months of updates included; the app keeps working after that |
| Refunds | 7-day money-back guarantee |
| Platforms | macOS, Windows, Linux |
| Pitch vs subscriptions | Cursor $20/mo and GitHub Copilot $10/mo shown as 3-year cost comparison |
| Offline | "Partial" |

**Their messaging, in one line:** one window, every tool an AI developer reaches for, pay once.

**Where this leaves ContextGit:**
- **Same category, different differentiator.** 1DevTool sells *the toolbox*. ContextGit sells *the toolbox
  plus versioned context and safe parallel agents*. Do not claim the toolbox is unique.
- **Price comparison:** ContextGit has no published price (see §7). Do not compare prices on the site until one exists.
- **Free-tier comparison:** 1DevTool's free tier has hard limits. ContextGit's local app has no limits planned
  (see §7). This is a real, honest difference to state, but only once the plan is confirmed.

### 6.2 Adjacent competitors (parallel-agent tools, from `files/all-in-one-landscape.md`)

These come from the repo's round-1 research, dated 2026-10-06. **Not re-verified today.** Re-check before publishing.

| Tool | Shape | Versions code | Versions context | Ships a toolbox |
|---|---|---|---|---|
| Cursor | VS Code fork, inline AI, $20/mo | ✓ | ✗ | ✗ editor only |
| Zed | Fast editor + collab | ✓ | ✗ | ✗ |
| BridgeMind | Agent super-app, split/dock panes, docked browser | ✓ worktrees | ✗ one-shot handoff | ⚠ partial |
| Conductor / Vibe Kanban / Superset | Parallel agents in worktrees | ✓ | ✗ | ✗ |
| **ContextGit** | Memory layer + agent board + toolbox | ✓ | **✓** | ✓ (desktop) |

**Gap statement (safe to publish after a re-check):** everyone versions *code* and almost nobody versions
*context*.

---

## 7. Pricing and business model (current state)

- **Public pricing page today:** no numbers. "Free on your machine. Paid for the cloud." Free = the whole
  local app, unlimited, no account. Pro (security audit, encrypted cloud sync, cloud agents, managed inference)
  and Team are listed as **coming soon**. Waitlist via mail link.
- **Strategy in `files/monetization-strategy.md`:** keep the local app free and unmetered; sell scale, cloud,
  security and collaboration. Recommended individual price anchor: **$20/mo** (not yet confirmed).
- **Open decision for the founder:** do we also sell a **one-time license** like 1DevTool? A one-time option
  would compete directly with 1DevTool's $29; a subscription would not. Decide before the pricing page
  publishes numbers. (See `files/plans-research.md` for the market bands.)

---

## 8. Gaps: what the current website gets wrong

The current site is the Next.js app in `app/`, `components/`, and `app/pricing/`. There is also an
older static prototype in `landing/` (not wired to anything; it still says `pip install` and has no
pricing).

| # | Current site says | Reality in the repo | Fix |
|---|---|---|---|
| 1 | Hero CTA: "Get the desktop app" → `#status`; install box says `pip install contextgit` | The product is the **desktop app**. The pip/CLI package is a secondary surface. | Lead with the desktop download; keep pip as a secondary "for the CLI" line. Confirm a download link exists first. |
| 2 | "Team mode is planned, not built" (Status section) | README: Team mode is **shipped** (tasks, roles, gate, verifier, MCP). | Move Team mode to "Shipped". |
| 3 | Status section and FAQ: "Phase 1 ships a fake provider…" and "Cloud sync… on the roadmap" | Desktop app, agents, browser, editor, API and DB tabs are shipped. | Rewrite FAQ and status to match §4. |
| 4 | No mention of the browser, editor, API client, database client, or auto-installed agent CLIs | These are the core of the product and the pain it solves. | Add an "all-in-one" section above "The problem". |
| 5 | Nav and sections are CLI-first (workflow = `contextgit commit/branch/…`) | The day-to-day UI is the desktop app. | Keep the CLI section, but present it as "for the terminal", not the headline. |
| 6 | Pricing teaser says "Team adds collaboration" and "No numbers yet" | Accurate today. | Keep until §7's decision is made. |
| 7 | Metadata: "version control for AI work" / "Run several coding agents…" | Accurate, but it omits the workbench. | Add the workbench to the description (see §10). |
| 8 | Competitor not addressed at all | 1DevTool is the closest and the category is now known. | Add a comparison page (see `pages.md`). |
| 9 | `landing/index.html` duplicates the page in plain HTML | Not wired to anything (README says so). | Delete or leave out of marketing work to avoid drift. Confirm with the founder. |

---

## 9. Claims to verify before publishing

Do not publish these without proof:

- **Performance:** "your PC stops hanging", "uses less RAM/CPU than N apps". Measure first (the founder's
  motivation is real, but there is no benchmark in the repo).
- **Database engine count:** "15 engines" (1DevTool's claim) — ContextGit's count must come from the bundled DbGate build.
- **"Works with all agents"** — say "11 agent CLIs" and link the list.
- **Merge quality numbers** ("3 of 4 retained") — the site's example is illustrative. Real eval runs live in
  `tests/evals/`; say so, or label the table "example".
- **Security** — the local API has no authentication (README). Do not say "secure" without the fix in
  `files/codebase-audit.md` (S1).
- **Platform support** — installers are configured for AppImage/deb/dmg/nsis. Confirm each has been built and works.
- **Status pages** — `files/remaining-phases.md` lists unbuilt items (endpoint graph, "Why" lens, MCP memory, bisect).
  Do not mark these as shipped.
- **Dates and "Early build" wording** — keep the honest "early, expect rough edges" note.

---

## 10. Core copy blocks (ready to use, pending §9 checks)

**Hero (H1):** Build in one window. Keep the context that worked.

**Hero sub-line:** ContextGit puts your coding agents, editor, browser, API and database clients in one
desktop app. Each agent gets its own git worktree, so parallel runs never collide, and every AI
conversation is a branchable history you can merge.

**Meta description (home):** ContextGit is a desktop workbench for AI development: run parallel coding
agents in isolated git worktrees, with an editor, browser, API and database client in one window, and
version-controlled AI context. Local-first.

**Meta description (pricing):** ContextGit is free on your machine. Paid plans add cloud sync, security
audit and team features. Prices are coming; join the waitlist.

**Three pillars (for the homepage):**
1. **One window** — agents, editor, browser, API and database clients, git. No alt-tab.
2. **Agents that don't collide** — one worktree per run, claimed files, a merge queue, an independent verifier.
3. **Context you can version** — branch a conversation, diff it, merge what was learned, roll back.

**Trust line:** Local-first. One SQLite file on your machine. Only your model calls leave it. Apache-2.0.

**Honest early-access note:** Early build. Expect rough edges. Open source, and built in the open.

---

## 11. Sources

Repo (primary, scanned 2026-10-08):
- `README.md` — feature list, layout, quickstart
- `files/all-in-one-landscape.md` — category, surface catalog, competitor table
- `files/desktop.md`, `files/code-harnesses.md`, `files/workspace-architecture.md` — desktop architecture, harness list
- `files/monetization-strategy.md`, `files/plans-research.md` — pricing strategy and market bands
- `files/roadmap.md`, `files/remaining-phases.md` — what is shipped vs planned
- `app/page.tsx`, `app/pricing/page.tsx`, `components/pricing-tiers.tsx`, `lib/pricing` — current site copy

Competitor (web, 2026-10-08):
- [1DevTool home](https://1devtool.com/) — positioning and "Free tier, $29 once"
- [1DevTool pricing](https://1devtool.com/pricing) — tiers, device counts, free-tier limits, feature table
- [1DevTool on Product Hunt](https://www.producthunt.com/products/1devtool) — third-party listing (free tier described as 1 project + 4 terminals)
- Secondary listings (AI Plaza, Neura) repeat the $29 / 1-device price; AI Plaza lists 3 devices at $59 — matches the pricing page.
