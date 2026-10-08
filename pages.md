# ContextGit — marketing pages

**Prepared:** 2026-10-08
**Companion:** `content.md` (what the site says, and the facts behind it).
**Status key:** ✅ exists · 🔁 exists, needs rewrite · 🆕 new · 🕐 later (don't build yet)

---

## 1. Site map

| # | Route | Page | Status | Priority |
|---|---|---|---|---|
| 1 | `/` | Home / landing | 🔁 | P0 |
| 2 | `/features` | Features | 🆕 | P0 |
| 3 | `/pricing` | Pricing | 🔁 | P0 |
| 4 | `/download` | Download / install | 🆕 | P0 |
| 5 | `/docs` | Docs hub | 🆕 | P1 |
| 6 | `/about` | About | 🆕 | P1 |
| 7 | `/compare/1devtool` | Comparison vs 1DevTool | 🆕 | P1 |
| 8 | `/roadmap` | Roadmap / status | 🆕 | P1 |
| 9 | `/security` | Security & privacy | 🆕 | P1 |
| 10 | `/changelog` | Changelog | 🕐 | P2 |
| 11 | `/blog` | Blog / articles | 🕐 | P2 |
| 12 | `/contact` | Contact / Enterprise | 🆕 | P2 |
| 13 | `/privacy`, `/terms` | Legal | 🆕 | P1 (required before paid tiers) |
| 14 | `/license` | Open source (Apache-2.0) | 🆕 | P2 |
| 15 | `/404` | Not found | 🆕 | P2 |

**Also in the repo, not a marketing page:** `landing/index.html` is an old static prototype
(not wired to anything, still says `pip install`). Remove it or keep it out of the marketing work.
Confirm with the founder first.

**Navigation (header):** Features · Workbench · Agents · Pricing · Docs · Download
**Footer:** Product (Features, Pricing, Download, Roadmap) · Resources (Docs, Compare, Changelog) ·
Company (About, Contact) · Open source (GitHub, Apache-2.0 license) · Legal (Privacy, Terms, Security)

Keep the nav to six items or fewer. The current site has ten anchor links, which is too many.

---

## 2. Page specs

### 2.1 Home — `/` (🔁 rewrite of `app/page.tsx`)

**Job:** make a developer understand in 10 seconds that this is one window for building with AI agents,
and send them to download.

**Title:** ContextGit — the one window for AI development
**Meta:** see `content.md` §10 (home).

| Section | Content | Source in `content.md` |
|---|---|---|
| Hero | H1 + sub-line + **Download** (primary) + **See features** (secondary). Interactive demo kept. | §10 |
| Trust strip | "Local-first · Apache-2.0 · Works with 11 agent CLIs" | §4.6, §4.2 |
| All-in-one | NEW. A tab strip mock: Code, Editor, Browser, API, Database, Git. Explains "no alt-tab". | §4.1 |
| Three pillars | One window · Agents that don't collide · Context you can version | §10 |
| Parallel runs | Keep the existing fleet/control-tower section. Rewrite the copy to match §4.3 and §4.4. | §4.3 |
| Versioned context | Keep the existing workflow/merge sections, but move the CLI detail to `/features`. | §4.5 |
| Pricing teaser | Keep `PricingTiers compact` → "Pricing" button. | §7 |
| Questions (FAQ) | Rewrite; see §3 of this doc. | §8 |
| Closing CTA | Download + "Read the docs" | — |

**Remove or move:** the long CLI-first workflow and the layer diagram move to `/features`. The status
roadmap moves to `/roadmap`.

### 2.2 Features — `/features` (🆕)

**Job:** a complete, scannable list of what ships, grouped the way §4 groups it.

**Title:** Features — ContextGit
**Meta:** "Everything in ContextGit: the editor, browser, API and database clients, parallel agent runs,
team mode and versioned conversations, in one local desktop app."

Sections (one anchor each, all linkable):
1. **One window** — terminal board, Editor, Browser, API, Database, Git, Assets (§4.1)
2. **Agents** — 11 CLIs + Shell, auto-install, usage limits, BYO model key (§4.2)
3. **Parallel runs** — worktrees, fleet view, claims, merge queue, paired merge (§4.3)
4. **Team mode** — tasks, roles, gate, verifier, MCP (§4.4)
5. **Versioned context** — commits, branches, diffs, semantic merge, probes (§4.5)
6. **Privacy** — local-first, what leaves the machine (§4.6)

Each section: one heading, one sentence, a bullet list, one small visual or screenshot, and a link to the
relevant doc in `files/` (e.g. `files/team-mode-architecture.md`). Use the claims rules in `content.md` §9.

### 2.3 Pricing — `/pricing` (🔁)

**Job:** make "free is real" obvious; show what paid adds; collect waitlist interest.

**Keep:** the existing plan cards, comparison table, "Free forever" block, waitlist and FAQ.
**Change:**
- Hero: "Free on your machine. Paid for the cloud." (already close).
- Add a short line that the local app has no limits and no account.
- **Blocked on a founder decision (`content.md` §7):** whether to add a one-time license option. Do not
  publish numbers until that is decided.
- Do **not** compare prices with 1DevTool on this page. Link to `/compare/1devtool` instead.

### 2.4 Download / Install — `/download` (🆕)

**Job:** get the desktop app installed. This page replaces the "pip install" box as the primary CTA.

**Title:** Download ContextGit
**Sections:**
1. **Download** — macOS, Windows, Linux with the installer for each (AppImage, .deb, dmg, nsis, per `desktop/package.json`).
   *Blocked until installers are published somewhere public. Do not show download buttons with no real file.*
2. **System requirements** — confirm first.
3. **Run from source** — the quickstart from `README.md` (desktop `npm install` / `npm run dev`).
4. **CLI only** — `pip install` line, labelled "for the terminal" and not the headline.
5. **First run** — create a repo, open the Code tab, launch a run.
6. **Troubleshooting / Issues** — link to GitHub issues.

### 2.5 Docs hub — `/docs` (🆕)

**Job:** a clear entry point to the real documentation. Use the existing `files/` docs; do not rewrite them.

**Title:** Docs — ContextGit
**Sections:**
- **Get started** — install, first repo, first agent run (from `README.md`)
- **Concepts** — conversations as commits, branches, merge, worktrees per run (from `files/architecture.md`, `files/data-model.md`, `files/merge-engine.md`)
- **Guides** — Team mode (`files/team-mode-architecture.md`, `files/team-mode-mcp.md`), chat sessions (`files/chat-sessions.md`), documents (`files/chat-documents.md`), usage (`files/usage.md`), code harnesses (`files/code-harnesses.md`)
- **Workbench** — desktop architecture (`files/desktop.md`, `files/workspace-architecture.md`, `files/embedding-clients.md`)
- **Reference** — CLI (`ctx --help`), MCP server (`contextgit-mcp --help`), API (`/api/v1`)
- **Contributing** — `files/AGENTS.md`, `files/codestyle.md`, `files/testing.md`, `CODE_OF_CONDUCT.md`

**Build note:** these are design/spec docs, not user docs. Several are written for agents (e.g.
`files/AGENTS.md`). Before publishing, write a short user-facing version of each guide. Don't ship the
internal docs as-is.

### 2.6 About — `/about` (🆕)

**Job:** explain why this exists and who builds it. Build trust for an open-source tool.

**Title:** About — ContextGit
**Sections:**
1. **Why we built it** — the founder's own pain: too many apps, too many agents, and a machine that hangs.
   Keep it factual and first-person. Do not add a performance claim without a measurement (`content.md` §9).
2. **What we believe** — local-first, one source of truth, record what you decided, never auto-resolve a conflict.
3. **How it's built** — the layers from `files/architecture.md` (core library, CLI/API, desktop), in plain language.
4. **Open source** — Apache-2.0, link to GitHub and `CODE_OF_CONDUCT.md`.
5. **Team** — *placeholder: needs the founder's details (names, photos, links). Do not invent people.*
6. **Contact** — link to `/contact`.

### 2.7 Compare: 1DevTool — `/compare/1devtool` (🆕)

**Job:** answer "how is this different from 1DevTool?" honestly, for people already comparing them.

**Title:** ContextGit vs 1DevTool
**Meta:** "1DevTool puts the dev toolbox in one window. ContextGit does that, and versions your AI
context with branches and merges. Here is how they compare."

**Sections:**
1. **Short answer** — both put the toolbox in one window. ContextGit also versions the AI context and runs
   parallel agents without collisions.
2. **Comparison table** — rows from `content.md` §6.1 (shape, agents, tools, free tier, price, updates,
   platforms, offline). For ContextGit, only list what is shipped. Leave price as "coming" until §7 is decided.
3. **Where 1DevTool is ahead today** — polished, signed installers and a one-time price; Docker, SSH/SFTP
   and a utilities toolbox. State these plainly.
4. **Where ContextGit is different** — versioned context, worktree-per-run, claims, verifier, merge queue.
5. **Who should pick which** — a short, honest decision guide.
6. **Last checked** — date of the competitor check, with a link to their pricing page. Re-check before publishing.

**Rule:** don't use competitor logos or claims we haven't checked. Keep the tone factual; don't disparage.

### 2.8 Roadmap / Status — `/roadmap` (🆕)

**Job:** show what ships and what is next, so the site stops contradicting the README.

**Title:** Roadmap — ContextGit
**Sections:**
- **Shipped** — list from `README.md` (desktop workbench, parallel runs, team mode, merge engine, all tabs, harnesses, usage)
- **Next** — from `files/remaining-phases.md`: endpoint graph, "Why" lens, MCP memory, bisect/replay, backlog
- **Later** — Docker manager, utilities, design canvas, cloud sync, Pro/Team tiers (`files/monetization-strategy.md`)
- **Honest note** — early build, plans can change.

Keep this page in sync with the README. It should be one source, not two.

### 2.9 Security & privacy — `/security` (🆕)

**Job:** give a clear, accurate statement of what stays local, and what is not yet secure.

**Title:** Security and privacy — ContextGit
**Sections:**
1. **Where your data lives** — one SQLite file; nothing syncs unless you turn it on (paid tiers later).
2. **What leaves your machine** — only the model calls you configure.
3. **Local API** — binds to localhost, has no authentication today. State it. Link the fix plan (`files/codebase-audit.md` S1).
4. **Reporting a vulnerability** — *placeholder: needs a security contact email from the founder.*
5. **Coming: security audit (Pro)** — labelled as planned (`files/security-tab-spec.md`).

Do not call the product "secure" on this page until the S1 fix ships.

### 2.10 Legal — `/privacy`, `/terms` (🆕)

**Job:** required before any paid tier, and before collecting a waitlist email with a real form.
**Note:** these need the founder or a lawyer to write them. Mark as placeholders in the build; don't publish generic template text.

### 2.11 Contact / Enterprise — `/contact` (🆕, P2)

**Job:** a place for Enterprise and team inquiries, as the pricing page's "Talk to us about Enterprise" link.
Replace the `mailto:` with a form only when there is somewhere to send it.

### 2.12 Later pages (🕐, do not build yet)

- **`/changelog`** — once there is a release cadence and tagged versions.
- **`/blog`** — once there are articles to publish. Good first topics: "why parallel agents collide",
  "branching a conversation", "how semantic merge decides what to keep".
- **`/license`** — can be a section of `/about` until it needs its own page.
- **`/404`** — a default Next.js page is fine until the site is live.

---

## 3. FAQ to carry across pages

Rewrite the home FAQ from `app/page.tsx` to match §4 of `content.md`. Suggested questions:

1. **Is this just summarizing my chat?** — No. History stays as immutable commits. Summaries are created only at merge time, with a preview and a conflict check.
2. **Is a merge lossless?** — No. A merge is a compact summary. The original branch is never deleted, and merge quality is checked with probe questions.
3. **Where does my data go?** — One local SQLite file. The only network traffic is calls to the model provider you chose.
4. **Which agents does it run?** — Eleven agent CLIs plus a shell, with auto-install. Bring your own model key.
5. **Do I need an account?** — No. The local app needs no account.
6. **Does it work with my editor?** — The workbench includes an embedded VS Code, and you can also open files in your own editor.
7. **Is it free?** — The local app is free. Paid tiers (cloud, security audit, team) are coming; prices aren't set yet.
8. **Does it support teams?** — Team mode is shipped locally. Cloud sync and multi-user collaboration are planned.
9. **Is it production-ready?** — Early build. Expect rough edges. Open source, Apache-2.0.

Make sure any answer that mentions a plan, price, or platform matches `content.md` §9.

---

## 4. Build order (suggested)

1. **P0 — launch set:** `/` (rewrite), `/features`, `/pricing` (small update), `/download`.
   Blocked on: installer links, the §7 pricing decision, and the §8 fixes.
2. **P1 — trust and context:** `/docs`, `/about`, `/compare/1devtool`, `/roadmap`, `/security`, `/privacy`, `/terms`.
3. **P2 — growth:** `/contact`, `/changelog`, `/blog`, `/license`, `/404`.
4. **Cleanup:** remove or quarantine `landing/index.html` once `/` is rewritten.

## 5. Shared components to reuse

From the repo, so new pages match the existing look:
- `components/site-header.tsx`, `components/site-footer.tsx` — take `links` props, so the nav changes in one place.
- `components/pricing-tiers.tsx` — used on home (compact) and pricing (full).
- `components/effects.tsx`, `components/copy-buttons.tsx` — reveal and copy behaviour.
- `lib/pricing` — tier data; keep the price fields empty until §7 is decided.

New shared pieces to add once: a `PageHero` (eyebrow, H1, lede, CTA row) and a `ComparisonTable`
(used on `/compare/1devtool` and `/pricing`).

## 6. Open questions for the founder

1. Installers: where will the downloads be hosted, and is there a version to link?
2. Pricing: one-time license (1DevTool's model), subscription, or both? (`content.md` §7)
3. Team section on `/about`: names, photos, links.
4. Security contact email for `/security`.
5. Keep, rewrite, or remove the `landing/` prototype?
6. Should the site call the product a "desktop app", a "workbench", or a "toolbox"? The content uses "workbench" and "desktop app".
