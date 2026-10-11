# Plan — ContextGit Pivot: "Run agents. We remember."

Status: **researched, direction approved** (capture: all three paths; injection: prompt + file first).
Scope: MVP, flow, and UI change. No code until each phase is picked up.

> **v2 — hardened with research.** This revision keeps every v1 decision and strengthens it with
> verified facts: exact agent hook/transcript formats, an HTTP-hook install path, a native
> `SessionStart` injection channel, a de-duplication design v1 was missing, and the real
> competitive field. New/changed material is marked **[v2]**.
>
> **v3 — Chat differentiators.** §7.5 adds the researched feature set for the Chat tab (Model
> Council · Image Lab · Deep Research · Context Blame · Context Governor), with the matching
> data/API block in §8, phases in §9, and sources at the end. New material is marked **[v3]**.

---

## 1. Why pivot (research summary)

### BridgeMind (bridgemind.ai) — the reference product
"The Agent Super App", $50/mo, native Mac/Win/Linux, BYO AI accounts. Three modes:

| Mode | What it does |
|---|---|
| Agent | Named agents on scheduled routines |
| Code | Live terminal panes over your folders — Claude Code, Codex, Cursor Agent, Gemini CLI, Copilot, Grok, Aider, OpenCode… whatever is on PATH |
| Thread | Coding sessions as readable conversations |

Strengths: split/snap/dock pane canvas · multi-account switching · local voice-to-text · docked
browser review · strong community funnel.

**Their weakness is our opening:** zero version control for *context*. Their own marketing describes
handoff as "a summary carries the conversation across" — one-shot, lossy, linear. No commits, no
branches, no diffs, no merge, no record of what was tried and failed.

### Competitive landscape **[v2 — expanded and verified]**
BridgeMind is not alone; "run N agents in panes" is now a crowded category. Every serious player
versions **code** (git worktrees), never **context**:

| Tool | What it is | Versions code | Versions the conversation |
|---|---|---|---|
| **Conductor** (Melty Labs, YC S24) | Mac app; Claude Code / Codex / Cursor / OpenCode in parallel, each in an isolated **git worktree** with its own branch, terminal, diff, PR path | ✓ worktrees | ✗ |
| **Vibe Kanban** (BloopAI) | OSS kanban → agent workspaces; hosted cloud **sunset Apr 2026**, now local OSS | ✓ worktrees | ✗ |
| **Superset** | "Orchestrate any coding agent" — parallel tasks, isolated changes, one review surface | ✓ | ✗ |
| **Nimbalyst** | OSS visual workspace for Claude Code / Codex / OpenCode | ✓ | ✗ |
| ccmanager · dmux · agentree | terminal multiplexers / worktree helpers | ✓ | ✗ |
| **cass** (coding-agent-session-search) | Read-only **search** across 11+ agents' session histories (BM25 + local semantic, `--json`) | ✗ | ✗ search only |
| Claude Code **native** | `/rewind` checkpoints + `claude agents` **agent view** + worktrees | ✓ | ⚠ partial — §1.3 |
| **ContextGit** | DAG: commits, branches, 3-level diffs, semantic merge, conflict resolution | ✓ | **✓** |

**The gap:** everyone version-controls code (worktrees/diffs/merges). **Nobody version-controls the
context itself.** `cass` proves demand but stops at search — no DAG, no branch, no merge, no injection.

### The honest foil: Claude Code's native memory **[v2]**
Claude Code *does* have memory-like features, so our positioning must be sharp. From its docs:
checkpoints are **per-session**, keep the **100 most recent**, are **deleted ~30 days** after the
session, and the docs state plainly: *"Not a replacement for version control."* `/rewind` restores
code+conversation **within one session**; it cannot merge two sessions or two agents. Agent view runs
parallel sessions, but each is isolated — nothing reconciles what they learned.

### Demand signals
- Agent transcripts already sit on disk and get deleted; the ecosystem built scraper + search tools
  just to keep them (`cass`, `cursor-history`, `cursor-session`). People mine these archive dirs by hand.
- Codex ships its own **Memory Pipeline** that feeds rollout history back into future sessions —
  vendors are moving toward memory, but **vendor-locked, linear, and unmergeable**. That is our lane.
- "Every new session starts with 5–15 min of re-establishing context" is a common complaint →
  auto-load is what users already want.
- `AGENTS.md` (agents.md repo ≈ 24.7k★ / 1.9k forks; read by Codex, Copilot, Cursor, Windsurf, Amp,
  Devin, Gemini CLI…) is the cross-agent *injection* point — with one caveat (§5.2).

### Positioning line
> **BridgeMind and friends run your agents. Claude Code remembers one session. ContextGit is the only
> layer that remembers *across* agents — durable, branchable, diffable, mergeable — and loads it into
> the next run automatically.**

---

## 2. New MVP

**Before:** a chat app with git semantics (user manually commits chat messages).
**After:** an **ambient context layer under a multi-agent terminal board** — history writes itself,
new sessions load themselves.

### In scope
1. **Terminal board** — multiple agent terminals in one window *(built, Phase 6)*
2. **Zero-touch background capture** — every agent turn auto-checkpointed into the DAG; manual
   staging optional, not required *(new)*
3. **Auto-restore** — a new session automatically receives relevant history: decisions, active
   threads, dead-end warnings *(new)*
4. **History board** — git-style list/graph, diff, branch, PR-style merge *(built, Phases 6–7)*
5. **Manual checkpoint as curation** — commit bar becomes "⚑ Checkpoint now" (+ auto-save toggle),
   not a required step

### Out of scope (parked)
**Chat as the front door** — Chat stays a first-class *tab* with its own feature set **[v3 — §7.5]** ·
compare-arena prominence · scheduled routines (BridgeMind's Agent mode) · voice input ·
multi-account manager · cloud/sync · multi-user

### Approved decisions
- **Capture:** all three paths — JSONL transcript tail **+** hooks receiver **+** PTY output fallback,
  developed together (Claude Code works day one; others progressively).
- **Injection:** prompt + file first — we spawn the terminals, so prepend the context packet and write
  `.contextgit/context.md` with an `AGENTS.md` block. MCP comes later.

---

## 3. New flow (user journey)

```
Open app ──► Terminal board (sidebar of runs)
   │
   ├─ "+ New run" → pick folder + agent (claude/codex/gemini/shell)
   │      → session + branch created, context auto-loaded          [new]
   │      → terminal starts ALREADY briefed (packet in the prompt /
   │        SessionStart additionalContext)                        [new]
   │
   ├─ Agent works → turns captured in background → auto-commits    [new]
   │      (decisions / facts / dead ends extracted by merge engine)
   │
   ├─ Hit a dead end / context rot / usage limit → start new run
   │      → picks up where you left off: what was decided,
   │        what failed, which branch — without re-explaining      [new]
   │
   └─ History tab → browse the DAG, diff runs, merge two runs' learnings
```

---

## 4. New UI (desktop app)

1. **Front door = Terminal board.** Sessions sidebar is primary; History becomes a tab.
2. **Auto-save bar** (replaces commit bar): `Auto-checkpoint` toggle (default ON) + "⚑ Checkpoint
   now" + staged-count chip. Commits happen without the user.
3. **Context-loaded indicator** per new terminal: `⟐ context loaded: 3 decisions · 2 dead ends · from
   auth-experiment` — click to inspect exactly what was injected (trust via transparency; also makes
   packet truncation visible).
4. **"Continue from…" picker** on new session: latest head · a known-good tag · any commit — with a
   preview of the context that will load.
5. **Session cards**: status dot + branch chip + token-burn mini-bar + **capture-source badge
   (hook/tail/pty)** so the user knows fidelity **[v2]**.
6. Keep the GitHub-style history list/graph and PR-style merge dialog as the History tab.

---

## 5. Capture architecture **[v2 — new section]**

v1 named the three paths but left the hard part unspecified: *how* they converge without
double-counting, and *what exactly* we read from each agent. One `contextgit/watch/` package, one
`Watcher` interface, per-agent adapters. All three paths converge on the **same core call** —
`Repo.stage(session_id, messages)` / `commit_staged(...)` — so business logic stays in `core/repo.py`.

```
agent turn ──► Path A: HTTP hook ─┐
                Path B: JSONL tail ├──► normalize(messages) ──► dedupe ──► Repo.stage/commit ──► DAG
                Path C: PTY parse ─┘
```

### 5.1 Path A — Claude Code hooks (official, day one)
**Verified:** Claude Code hooks support `type: "http"` — Claude Code POSTs the event JSON directly to
a URL. **No shell script wrapper needed.**

- **Events to subscribe:** `Stop` (turn finished — primary), `UserPromptSubmit` (the prompt),
  `SessionStart` (link the agent session id ↔ ContextGit session/branch), `SessionEnd`, `PreCompact`.
- **Payload fields we use** (common + `Stop`-specific): `session_id`, `transcript_path`, `cwd`,
  `hook_event_name`, `prompt`, and on `Stop`: `last_assistant_message` + `stop_hook_active`.
  `last_assistant_message` means we do **not** need to parse the transcript to get the turn's answer.
- **Install without touching the user's files (preferred):** ContextGit owns the PTY, so it can launch
  `claude --settings '<inline JSON hooks config>'` per session — scoped to the runs we spawn. Fallback
  for user-run agents: write a project `.claude/settings.json` via `ctx watch install claude`.
- **Allowlist:** HTTP hooks require the URL in `allowedHttpHookUrls`; include our loopback URL in the
  settings we inject.

### 5.2 Path B — transcript tail (fallback for CLIs without hooks)
Verified on-disk formats (all append-only; tail from a saved offset, normalize, dedupe):

| Agent | Location | Format | Turn boundary |
|---|---|---|---|
| **Claude Code** | `~/.claude/projects/<url-encoded-cwd>/<session-id>.jsonl` | JSONL; `type` ∈ user/assistant/system; `message.content[]` blocks (`text`, `tool_use`, `tool_result`, `thinking`); `message.usage` | `assistant` line after a `user` line |
| **Codex CLI** | `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl` (+ `state.sqlite` index) | JSONL `{timestamp,type,payload}`; types `session_meta`,`turn_context`,`response_item`,`event_msg`,`compacted`; `event_msg.payload.type` ∈ `user_message`,`agent_message`,`token_count`,`turn_complete`; tool calls paired by `call_id` | `event_msg:turn_complete` |
| **Gemini CLI** | `~/.gemini/tmp/**` (session-id keyed) | JSON session checkpoints (auto-cleaned by Gemini) | on file flush |
| **Aider** | `.aider.chat.history.md` (in-project) | Markdown turns | `####` turn headers |
| **Cursor (agent CLI/IDE)** | globalStorage `store.db` + agent-transcript JSONL | JSONL / SQLite | on write |

New agent = one adapter behind `Watcher`; unknown agents degrade to Path C.

### 5.3 Path C — PTY output parse (agent-agnostic last resort)
We own the PTY, so we see every byte. Heuristic: strip ANSI, detect prompt/response boundaries, stage
as `tool` messages. Lowest fidelity → stage only, **never auto-commit on parse alone**.

### 5.4 De-duplication & cursors **[v2 — v1 missing this]**
The three paths *will* report the same turn. Rules:
- **Idempotency key** per turn: `(session_id, agent, turn_seq)` plus a content hash of
  `(user_prompt, assistant_message)`. Skip if the hash already exists in staging or recent commits.
- **Precedence** when two paths deliver the same hash: **A (hook) > B (tail) > C (PTY)**.
- **`ingest_cursor` table**: one row per `(session_id, source, path)` storing byte/line offset +
  last-seen timestamp, so a restart resumes rather than replays.
- Hooks fire on `Stop`; the tail may lag (the transcript is written asynchronously). Cursor keeps them
  consistent; the hash is the backstop.

### 5.5 Security & privacy **[v2]**
- The hooks receiver is **local-only**: bind `127.0.0.1`, require a per-session token header, reject
  non-loopback. (The API already binds localhost with no auth — the hook route must not widen that.)
- **Redaction pass** before staging: strip obvious secrets (API keys, tokens, `.env` values) with a
  configurable pattern set; transcripts include tool I/O that may contain credentials.
- Packets are machine-local; nothing leaves the machine except LLM calls (existing rule).

---

## 6. Injection architecture **[v2 — expanded to three channels]**

### 6.1 Channel 1 — initial prompt (we spawn the terminal → reliable, all agents)
ContextGit creates the session, builds the packet, prepends it as the agent's first input, and writes
it to a file it references. Works for **any** agent CLI. Hook point already exists: `bootstrap` on
`pty-start` in `desktop/electron/pty.ts`.

### 6.2 Channel 2 — file / AGENTS.md block
**Reality check (verified): AGENTS.md is plain markdown — there is no include directive.** v1's
"AGENTS.md include" is not a thing. Replace it with a **managed block**:

```md
<!-- contextgit:start -->
## Project memory (auto-generated)
Read `.contextgit/context.md` before starting. It holds decisions, established facts, open
questions, and dead ends from prior runs. Do not edit this block.
<!-- contextgit:end -->
```
Plus write `.contextgit/context.md` (the full packet). If a block already exists, replace only the
marked region; never clobber the user's file. `ctx inject` writes it; `--print` shows the diff.

### 6.3 Channel 3 — Claude Code `SessionStart` `additionalContext` **[v2]**
Claude Code's `SessionStart` hook can return `hookSpecificOutput.additionalContext` (and
`initialUserMessage`, `sessionTitle`) — injecting the packet **before the first prompt** as a system
reminder, with no prompt-typing fragility. Cap: **10,000 characters** (over that, Claude Code swaps in
a file path + preview). The packet builder must therefore be char-budgeted to fit. This is our
cleanest channel for the flagship agent.

### 6.4 MCP (later)
`contextgit-mcp` exposing tools/resources so *any* MCP client pulls "what we decided."

---

## 7. Feature set — ranked by differentiation

### Tier 1 — the moat (nobody ships these)
1. **Ambient auto-commit (zero-touch history).** Background watcher turns agent turns into checkpoint
   commits.
   - Path A — **hooks receiver**: Claude Code `Stop`/`PostToolUse`/`SessionStart` hooks → `POST /api/v1/hooks/agent` (official, reliable).
   - Path B — **transcript tail**: watch `~/.claude/projects/*.jsonl` + Codex rollout dirs; fallback for CLIs without hooks.
   - Path C — **PTY output parse**: last resort, agent-agnostic.
   - Turns run through the existing semantic engine → commits carry decisions/facts/dead-ends, not raw logs.
2. **Auto-restore (new sessions load history automatically).**
   - Channel 1 — **initial prompt**: terminals we spawn get the context packet prepended.
   - Channel 2 — **file injection**: write `.contextgit/context.md` + an AGENTS.md managed block (covers Codex/Gemini/Aider with zero cooperation).
   - Channel 3 — **Claude Code `SessionStart additionalContext`** (native, pre-prompt).
   - Packet is branch-aware and token/char-budgeted; the UI shows what was injected.
3. **Dead-end memory — "don't do this again."** `kind: note` commits become injected warnings
   (`cache-redis failed: 50ms skew broke the token bucket — avoid`). No competitor has a failed-branch
   concept; this is the emotional hook.

### Tier 2 — amplifiers (extend what exists)
4. **ContextGit MCP server** — `get_context`, `list_dead_ends`, `search_history`, `branch_context`
   for any agent in any tool.
5. **Cross-agent handoff as a durable branch** — "give this to Codex" = fork branch + compact packet;
   `model` recorded per commit. Diffs and merges survive, unlike BridgeMind's one-shot handoff.
6. **Worktree + context pairing** — each run gets a git worktree (code) *and* a context branch
   (conversation), paired and mergeable together. The honest answer to Conductor's worktrees.
7. **Semantic merge of parallel runs** — merge what two agents learned (existing engine; the original
   differentiator, still standing).

### Tier 3 — polish (prioritized from earlier backlog)
8. Transcript import → now partly subsumed by capture 9. Context burn/budget bar + rot warnings
10. Timeline replay 11. Semantic search over history 12. Compare arena (de-prioritized)
13. Local/Ollama provider

---

## 7.5 Chat differentiators — the Chat tab **[v3 — new section]**

Status: **researched, not built.** Chat is a first-class *tab*, not the front door — §2 still stands
on that. Native memory is now table stakes (ChatGPT *Dreaming*, Claude Memory, Gemini memories), but
all three are **vendor-locked, single-platform, single-user**; §1's gap is unchanged (cross-agent,
durable, versioned context). These five are how the Chat tab feels different instead of being
"just another chat".

**Reality check:** chat models (Claude / GPT / Grok / MiMo) are text models and **cannot draw**.
Codex ships images because an image endpoint is wired *behind* it. So the image lever is ours to
build: the chat model writes and refines the prompt, a **dedicated image model** renders it.

| # | Feature | One line | Leverages | Cost |
|---|---|---|---|---|
| 1 | Model Council | one prompt → N models in parallel → the winner becomes the branch head | existing provider adapters + fan-out | S–M |
| 2 | Image Lab | the *prompt* is the versioned artifact; iterate the prompt, then render | DAG (prompt commits) + image adapter | M–L |
| 3 | Context Blame | click any claim → which turn/session/agent introduced it, and what it replaced | extraction + reverse index | M |
| 4 | Context Governor | visible budget + compaction receipts; dead ends are never dropped | `build_packet` + per-model budgets | M |
| 5 | Deep Research | plan → search → read → gap-check → cited report, committed as a branch | DAG + merge extractor + search backend | M |

**Build order:** 1 → 2 → 3 → 4 → 5 (cheapest leverage first; Deep Research is the largest build).

### 7.5.1 Model Council — one prompt, N answers, one decision
Send the same prompt to 2–3 providers at once; answers land side by side; picking one makes it the
branch head and records **which model and why**. The compare flow already exists — this adds
**fan-out plus a recorded decision**, so "last time Grok answered this better" is history, not memory.
Cheapest of the five: reuses the provider adapters the model picker already drives.

### 7.5.2 Image Lab — the prompt as a versioned artifact
The chat model turns a rough idea into a production prompt (style, lens, lighting, negative prompt,
aspect). Iterate the prompt as text, then **Generate** → a real image model call. Our edge is that the
**prompt has history**: "which prompt produced the good one" becomes a diff, not a memory, and the
same prompt can be batched across 2–3 image models with the winner kept. Cloud adapters: GPT Image
1.5 · Ideogram v3/v4 · Flux 2 · Imagen 4. Local: Flux / SDXL via ComfyUI (GPU, $0 per image).
**Constraint:** separate endpoints and separate billing from the chat model — no chat model "draws
better" on its own; the levers are prompt quality, model choice, seed.

### 7.5.3 Context Blame — "how do we know this?"
Click any claim, decision, or line → see which **turn, session, branch, and agent** introduced it,
what it replaced, and jump/replay to that point. 2026's provenance tools (AgentDiff,
code-provenance, GitBlame) blame **code lines**; we blame **context** — the chain where a fact born
in a Claude turn was inherited by Codex and merged into main. Native memory is session-scoped and
cannot answer it. Reuses the merge engine's per-commit extraction; blame is a reverse index over
those extracted claims.

### 7.5.4 Context Governor — rot control, with receipts
A visible context budget per session and model: how full it is, what got compacted, **what got
dropped** (receipts), plus pin/keep controls. **Dead ends are never dropped.** Compaction is standard
*inside* agents; a chat that shows the user what it dropped — and lets them override — is not.
Evidence: context rot is real, and observation masking beat LLM summarization (52% cheaper, +2.6%
solve rate). Reuses `repo.build_packet` (already token/char-budgeted, branch-aware, dead-end-aware).

### 7.5.5 Deep Research — a branch, not an answer
Loop: clarify intent → explicit plan → iterative search and read → evaluate gaps → synthesize a
long-form report with **inline citations**. Each step commits; the report is a summary commit. Why it
matters: research becomes **diffable and mergeable** — compare two research runs, merge their
findings, and auto-inject the result into later chats (dead ends included). Needs a search backend
(SearxNG / Brave / Exa) with citations stored locally.

---

## 8. Data model & API additions **[v2 — new section]**

### Schema (new migration `0003_watch.sql`, plus a `packets` cache if we cache by commit id)
- `ingest_cursor(session_id, source, path, offset, last_event_at)` — tail resume points.
- `turn_digest(session_id, hash, source, commit_id, created_at)` — idempotency/dedupe index.
- `capture_source` column on `sessions` (`hook|tail|pty`) — drives the badge + auto-commit policy.

### API (all localhost-only)
- `POST /api/v1/hooks/agent` — receive Claude Code hook JSON (Path A). Token-guarded.
- `POST /api/v1/sessions/{id}/restore-preview` — what *will* be injected (chip + picker).
- `GET  /api/v1/sessions/{id}/context-loaded` — what *was* injected, for transparency.
- `POST /api/v1/sessions/{id}/capture` — internal ingest from tail/PTY (normalize → stage).

### Core (business logic stays in `core/repo.py`)
- `repo.build_packet(commit_id, provider, budget_tokens)` — token/char-budgeted, branch-aware,
  dead-end-aware; renders an injectable block; deterministic fallback when no provider.
- `repo.record_turn(session_id, messages, source)` — dedupe (turn_digest) → stage or commit per policy.
- `repo.watch_cursor(session_id, source)` / `advance_cursor(...)`.

### Chat **[v3]**
- **Schema:** `research_runs(session_id, plan, report_commit_id, budget)` · `citations(commit_id, url,
  title, quote, retrieved_at)` · `images(commit_id, provider, model, prompt, seed, path)` ·
  `council_votes(prompt_hash, provider, model, commit_id, picked)` · `claim_index(commit_id,
  claim_hash, kind, text)` (reverse index that powers blame) · `compaction_log(commit_id, kept[],
  dropped[], reason)`.
- **Core:** `repo.blame(claim_hash)` · `repo.compact(session_id, policy)` → receipts ·
  `repo.council(prompt, providers[])` → candidates + a pick/merge commit · `repo.render_image(prompt,
  provider, model)` (adapter lives in `llm/`, never called directly).
- **API:** `POST /api/v1/chat/council` · `POST /api/v1/chat/image` · `GET /api/v1/blame?claim=` ·
  `POST /api/v1/sessions/{id}/compact` · `POST /api/v1/research`.
- Rendered images live in `.contextgit/assets/`; nothing leaves the machine except provider calls.

---

## 9. Implementation map (when phases are picked up)

| Area | Change |
|---|---|
| Core | auto-commit policy (watcher → stage/commit); context packet builder (token/char-budgeted, branch-aware, dead-end-aware); dedupe + cursors |
| New pkg | `contextgit/watch/` — hooks receiver route + JSONL tailers (per-agent adapters) + PTY parse hook-in |
| New pkg | `contextgit/inject/` — packet writer (`.contextgit/context.md`, AGENTS.md managed block, prompt bootstrap) |
| API | `POST /api/v1/hooks/agent` (local-only, token), `POST /sessions/{id}/restore-preview`, `GET /sessions/{id}/context-loaded`, `POST /sessions/{id}/capture` |
| Desktop | front door = terminal board; auto-save bar; context-loaded chip; capture-source badge; "Continue from…" picker |
| Docs | roadmap re-baseline: Phase 10 ambient capture, Phase 11 auto-restore, Phase 12 MCP + handoff |

Reuses Phases 1–8: DAG, staging, sessions, terminals, merge engine, GitHub-style history. The pivot
**automates** what exists and changes the front door.

### Suggested phase order
- **Phase 10 — Ambient capture:** hooks route + JSONL tailers + PTY fallback; dedupe + cursors;
  auto-commit policy; "Auto-save" bar. *Acceptance: run Claude Code in a ContextGit terminal → see
  checkpoint commits appear in History with zero clicks; kill/restart and nothing replays.*
- **Phase 11 — Auto-restore:** packet builder + prompt/`SessionStart`/file injection + "Continue
  from…" picker + context-loaded chip. *Acceptance: new run starts already knowing last run's
  decisions and dead ends; chip shows exactly what was injected; packet fits the 10k cap.*
- **Phase 12 — Reach:** MCP server, cross-agent handoff, worktree pairing.
- **Phase 13 — Polish:** Tier 3 items.
- **Phase 14 — Chat differentiators [v3]:** Model Council → Image Lab → Context Blame → Context
  Governor → Deep Research (§7.5, cheapest-first). *Acceptance: council fans one prompt to 3 providers
  and records the pick as the branch head; an image renders from a prompt that has history; blame
  answers "which turn/session introduced this claim"; the governor shows compaction receipts and never
  drops a dead end; a deep research run lands as a cited branch.*

### Risks
| Risk | Mitigation |
|---|---|
| Transcript formats change / differ per agent | Three capture paths; per-agent adapters behind one `watcher` interface; degrade A→B→C; pin format assumptions in adapter tests |
| Three paths double-count the same turn | Idempotency hash + source precedence (hook > tail > pty) + `ingest_cursor` |
| Auto-commits pollute history with noise | Semantic extraction already filters; auto-checkpoints squash into logical checkpoints; manual curation stays; PTY-parse never auto-commits |
| Injected packet eats context budget | Token/char-budgeted packet with dead-ends first; UI preview; per-model budgets; **must fit Claude Code's 10k `additionalContext` cap** |
| Hooks require agent cooperation + URL allowlist | Hooks are an *enhancement* only — transcript tail works without them; inject the allowlist in the `--settings` we pass |
| Secrets in transcripts get committed | Redaction pass before staging; configurable patterns; local-only storage |
| Hooks receiver widens the local attack surface | Loopback bind + per-session token + reject non-loopback |
| Scope creep back toward BridgeMind feature parity | Out-of-scope list above; we compete on memory, not on routines/voice/accounts |
| Claude Code ships memory natively | We are the cross-agent, durable, mergeable layer; native memory is session-scoped and ephemeral (§1.3); integrate where we can, don't fight it |
| Chat features balloon scope (§7.5) | Cheapest-first build order (council → image → blame → governor → research); each ships standalone and is useful on its own |
| Image generation needs its own endpoints, keys, and billing | Adapters live behind `llm/`; cloud by default, ComfyUI opt-in; copy never implies the chat model draws; separate from chat-model billing |
| Deep research burns real time and tokens per run | Explicit per-run budget, visible step log, and every step is its own commit — a stopped run still leaves usable history |
| Council multiplies cost by N models | Cap at 3 providers; the pick records a reason; reuse the existing compare plumbing rather than new machinery |
| Auto-compaction drops something the user needed | Receipts list every drop, pin/keep overrides exist, and **dead ends are never dropped** |

### Open questions (need a call before Phase 10/11 and Phase 14)
1. **Hook install scope** — per-session `--settings` injection (clean, scoped) vs project
   `.claude/settings.json` (shareable, but modifies the user's repo)? Recommend: both, `--settings`
   first, project install behind `ctx watch install`.
2. **Auto-commit granularity** — every turn, or squash into one checkpoint per idle window?
   Recommend: idle-window squashing (less noise).
3. **Packet cap policy** — what to drop first over budget (open questions → dead ends → facts)?
   Recommend: never drop dead ends.
4. **AGENTS.md block** — opt-in per run, or default when the repo already has an AGENTS.md?
5. **[v3] First image provider** — cloud (GPT Image 1.5 / Ideogram v3 / Flux 2) or local ComfyUI?
   Recommend: cloud first (no GPU assumption), local behind a setting.
6. **[v3] Search backend for Deep Research** — SearxNG (self-hosted, private) or Brave/Exa (better
   results, API key)? Recommend: SearxNG default, API providers opt-in — keeps the local-first rule.
7. **[v3] Council size cap** — 2 or 3 providers? Recommend: 3, and remember the last pick per prompt.

---

## Sources

- [BridgeMind — Agent Super App](https://www.bridgemind.ai/)
- [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks) · [Hooks guide](https://code.claude.com/docs/en/hooks-guide)
- [Claude Code Checkpointing](https://code.claude.com/docs/en/checkpointing)
- [Claude Code — Run agents in parallel](https://code.claude.com/docs/en/agents) · [Agent view](https://code.claude.com/docs/en/agent-view)
- [Claude Code log locations](https://claude-dev.tools/docs/log-locations) · [JSONL transcript format](https://claude-dev.tools/docs/jsonl-format)
- [Codex CLI session history / rollout format](https://codex.danielvaughan.com/2026/06/01/codex-cli-session-history-local-search-rollout-format-knowledge-mining/)
- [Gemini CLI session management](https://geminicli.com/docs/cli/session-management/) · [Aider chat history format](https://deepwiki.com/Aider-AI/aider/3.5-message-formatting-and-chat-history)
- [Cursor agent local history](https://jazzyalex.github.io/agent-sessions/guides/cursor-agent-local-history.html)
- [Conductor](https://www.conductor.build/) · [Vibe Kanban](https://github.com/BloopAI/vibe-kanban) · [Superset](https://superset.sh/) · [Nimbalyst](https://github.com/Nimbalyst/nimbalyst)
- [cass — coding-agent-session-search](https://github.com/Dicklesworthstone/coding_agent_session_search)
- [AGENTS.md](https://agents.md/) · [agents.md repo](https://github.com/agentsmd/agents.md)
- [Model Context Protocol](https://modelcontextprotocol.io/)

Chat differentiators **[v3]**
- [AI Memory Compared 2026](https://www.memorylake.ai/en/blogs/ai-memory-compared-2026) · [AI Memory Wars 2026](https://aimemory.pro/blog/ai-memory-wars-2026-chatgpt-claude-gemini)
- [Agent context compression (context rot)](https://agentmarketcap.ai/blog/2026/04/10/agent-context-compression-techniques-2026) · [Context compaction pattern for long-running agents](https://www.agentnative.dev/patterns/context-compaction-pattern-for-long-running-agents)
- [AgentDiff — git blame for vibe coding](https://sunilmallya.github.io/agentdiff.html) · [AI code provenance](https://getagentdiff.com/ai-code-provenance)
- [Deep Research Agents: A Systematic Examination and Roadmap](https://arxiv.org/abs/2506.18096) · [Deep research agent architectures](https://zylos.ai/research/2026-04-21-deep-research-agent-architectures/)
- [Best AI image-generation APIs 2026](https://www.atlascloud.ai/blog/tips/best-ai-image-generation-apis-in-2026-complete-developer-guide) · [Local image generation: Flux, SD & ComfyUI](https://www.digitalapplied.com/blog/local-image-generation-flux-stable-diffusion-comfyui-2026)
- [Claude Artifacts](https://claude.com/features/artifacts)
