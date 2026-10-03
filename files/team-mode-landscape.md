# Team mode — Round 1: landscape & prior art

> Research round 1 of 3. Companions: `team-mode-concept.md` (round 2),
> `team-mode-architecture.md` (round 3). Verified 2026-10-03.

## The two modes

The Code tab gets a **mode switch**:

- **Single** — one agent, one terminal, one branch. Today's behaviour.
- **Team** — N agents, each with a role, its own worktree/branch, a shared task
  list, and a way to talk. This is the new surface.

This doc answers: *what already exists, and where is the gap?*

## The four tiers of multi-agent coding (2026)

| Tier | What it is | Examples |
|---|---|---|
| **1. In-process** | Subagents spawned by one session | Claude Code subagents; Codex subagents |
| **2. Agent teams** | Peer sessions in one terminal, shared task list + mailbox | Claude Code **Agent Teams** (experimental) |
| **3. Local orchestrators** | Worktree per agent + a dashboard/board, you stay in the loop | **Vibe Kanban**, Conductor, Gastown, Claude Squad, Nimbalyst, **BridgeMind** |
| **4. Cloud async** | Task → cloud VM → PR | Claude Code Web, Codex Web, Copilot Coding Agent, Jules, Cursor Cloud/Glass |

Most tooling is at **tier 3** — exactly where our Code tab lives.

## Prior art, concretely

**Claude Code Agent Teams** (closest reference):
- **Lead + teammates**; each teammate is a full session with its own context window.
- **Shared task list** with states `pending / in_progress / completed / blocked`,
  **dependency tracking** (completing a task auto-unblocks dependents), **file
  locking** on claim.
- **Mailbox per agent** (JSON files under `~/.claude/teams/<team>/inboxes/`) plus
  `SendMessage` for **peer-to-peer messaging** (backend tells frontend the API
  contract without going through the lead).
- **Hooks** as quality gates: `TeammateIdle`, `TaskCreated`, `TaskCompleted`
  (exit 2 = keep working / block).
- Stated best practices: **3–5 teammates**, **each teammate owns a different set
  of files**, **cross-layer coordination** (frontend/backend/tests) is a named use
  case, token cost scales linearly.
- Limits: experimental, one team per session, no nested teams, no resume of
  in-process teammates, task status can lag.

**Vibe Kanban** (closest UI):
- Per-agent **workspace**: private branch + virtual terminal + **dedicated dev
  server** (port isolation).
- **Kanban board** (drag card → agent starts), **inline diff review with comments
  sent back to the agent**, and a **live app preview**.
- **Agent context synchronization**: "if Agent A fixed a bug in the API layer,
  Agent B is aware of the API changes" — exactly the user's request.
- Open source (Apache-2.0) after the vendor shut down.

**Others:** Conductor (worktrees + diff-first dashboard, macOS), Gastown "beads"
(git-backed immutable decision records), Cursor Glass (control plane is the
product), Copilot / Jules / Codex Web (async PR machines), Intent/Augment Cosmos
(Coordinator + Specialist + **Verifier** agents).

## Protocols (the "talking" standards)

- **MCP** (Anthropic → Linux Foundation AAIF): agent ↔ **tool**. JSON-RPC 2.0,
  `stdio` / SSE / streamable HTTP. Resources, tools, prompts, sampling. ~97M
  monthly SDK downloads; built into every major client.
- **A2A** (Google → AAIF): agent ↔ **agent**. **Agent Cards** at
  `/.well-known/agent.json`, tasks with a state machine
  (`submitted/working/input-required/completed/failed/canceled`), messages,
  artifacts, SSE streaming.
- Consensus stack: **WebMCP (agent↔web) → MCP (agent↔tool) → A2A (agent↔agent)**.
  Rule: **MCP for tools, A2A for peers.**

## What the landscape does *not* have

1. **Nobody versions the conversation.** Every tool versions **code**
   (worktrees, diffs, merges). None pairs a worktree with a **context branch** so
   the *reasoning* merges with the diff.
2. **Context sync is shallow.** Vibe Kanban keeps memory across tickets; Claude
   Code teams message each other — but nothing records *cross-run decision traces*
   as a mergeable artefact.
3. **Conflicts handled reactively.** Ownership is advisory ("don't edit the same
   file"). Nothing enforces claims, reserves contract files, or pre-detects
   *semantic* disagreement across run conversations.
4. **Verification is bolted on.** The orchestrator rarely owns the verifier + gate.

## Where ContextGit already stands (Phases A–E)

- **Isolation**: worktree + branch per run (`contextgit/gitops/worktree.py`).
- **Visibility**: `GET /fleet` — changed files, ahead/behind, conflicts, overlaps.
- **Ownership**: scopes + `claims` table + overlap detection (`gitops/globs.py`).
- **Coordination (v0)**: managed `AGENTS.md` block + `.contextgit/context.md`
  with peers' scopes and a digest of their recent decisions; `shared_context`,
  `cross_run_conflicts`.
- **Integration**: checkout-free `integrate` + merge queue; **paired code+context
  merge** (`Repo.integrate_run`).

Missing is the **team layer**: task graph, enforced ownership, a live channel,
verification gate, and the Single|Team UI.

## Sources

- [Claude Code — Agent Teams](https://code.claude.com/docs/en/agent-teams)
- [Vibe Kanban — deep dive](https://aiindigo.com/blog/vibe-kanban-deep-dive-technical-review)
- [MCP vs A2A — complete guide 2026](https://dev.to/pockit_tools/mcp-vs-a2a-the-complete-guide-to-ai-agent-protocols-in-2026-30li)
- [Addy Osmani — The Code Agent Orchestra](https://addyosmani.com/blog/code-agent-orchestra/)
- [Codex CLI — worktrees & multi-agent](https://codex.danielvaughan.com/2026/03/26/codex-cli-worktree-parallel-development/)
