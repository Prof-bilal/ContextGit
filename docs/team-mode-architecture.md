# Team mode — Round 3: architecture

> Research round 3 of 3. Companions: `team-mode-landscape.md`,
> `team-mode-concept.md`. Status: proposal, builds on Phases A–E. Verified 2026-10-03.

## Principles (inherited from the repo)

- Core library owns all logic; API routes and React components stay thin.
- Local-first, single user, SQLite, numbered migrations, deterministic commits.
- Reuse existing seams: `Repo`, `gitops/` (worktrees, integrate, claims), the
  merge engine, the fleet endpoint.

## Component view

```
┌──────────────────────────── Electron (renderer + main) ────────────────────────────┐
│ Code tab:  [ Single | Team ]                                                        │
│   Single → AgentRail + CodeView (today)                                             │
│   Team   → TeamBoard (tasks, roles, deps, status) + TaskDetail + Messages + Queue   │
│ pty-start = the run's worktree cwd (already threaded)                               │
└───────────────▲──────────────────────────────────────────────▲─────────────────────┘
                │ REST /api/v1/team…                            │ MCP (stdio)
┌───────────────┴──────────────────────────────────────────────┴─────────────────────┐
│ FastAPI (thin)                                                                     │
├────────────────────────────────────────────────────────────────────────────────────┤
│ core/coordinator.py  — task graph, scheduler, gating, handoff notifications         │
│ core/team.py         — missions, tasks, roles, claims, board                        │
│ core/repo.py         — sessions, worktrees, integrate_run, merge queue (exists)     │
│ gitops/              — Git, WorktreeManager, merge, integrate, status, claims (exists)│
│ merge/               — semantic extraction, cross-run conflicts (exists)            │
│ storage/sqlite.py    — teams, tasks, task_deps, messages, events (new tables)       │
└────────────────────────────────────────────────────────────────────────────────────┘
                │ stdio
        contextgit-mcp  — tools an agent calls to see/ask/claim
```

## Data model (migration `0006_team.sql`)

```sql
teams(id, name, project_path, base_ref, created_at, updated_at)
tasks(id, team_id, title, brief, done_criteria, role, status,   -- todo|blocked|working|review|done|failed
      agent, session_id, scope TEXT,        -- JSON globs (mirrored into claims)
      contract TEXT, tokens INTEGER, position INTEGER, created_at, updated_at)
task_deps(task_id, depends_on_task_id, PRIMARY KEY(task_id, depends_on_task_id))
messages(id, team_id, task_id, from_task_id,
         kind,                              -- update|question|answer|handoff|contract|review
         body, created_at)
events(id, team_id, kind, task_id, payload TEXT, created_at)  -- audit / decision traces
```

`tasks.session_id` links a task to the Phase-A `Session` (worktree + context
branch). Helpers: `blocked_tasks(team)`, `dependents(task)`, `unblock(task)`,
`board(team)`.

## Coordinator

`core/coordinator.py` — one small state machine over the task graph:

- **launch(team)**: create a worktree/branch per task (Phase A), record claims
  (Phase C), write role + scope + deps into the managed board, start unblocked
  tasks with their briefing, mark the rest `blocked`.
- **on_task_complete(task)**: run its **quality gate** (tests/lint/type-check in
  the task's worktree). Green → `review`; red → `working` with feedback.
- **on_task_reviewed(task, verdict)**: green → `done` and **unblock dependents**;
  red → `working` with the reviewer's findings.
- **on_dependency_ready(dep, dependents)**: post a `handoff`/`contract` message and
  notify each dependent run (board update + MCP message + context re-sync).
- **run_queue(team)**: merge `done` tasks in dependency order via the Phase-D
  queue, re-checking after each merge; use `integrate_run` so code **and** context
  land together.

Pattern: **supervisor + DAG + event-driven** — a fixed graph decides order;
events (task done, gate failed, conflict) drive transitions; agents are workers.

## The channel (how agents "talk")

Three layers, cheapest first:

1. **Managed board file** — `.contextgit/team.md` (+ the `AGENTS.md` block): tasks,
   owners, statuses, latest N messages. Written on state change; read by agents at
   start and after each step. Async "talking".
2. **MCP server** (`contextgit-mcp`, stdio) — tools an agent calls *during* work:
   - `team_status()` → tasks, owners, statuses, blockers
   - `list_tasks(filter)`, `claim_task(id)`, `complete_task(id, evidence)`
   - `post_update(text)`, `read_board(since)`
   - `check_ownership(path)` → owner or free
   - `publish_contract(task, path)` → publish + notify dependents
   - `request_handoff(to_task, message)`, `await_dependency(task_id)`
   - `peers()` → other runs, their scope, their latest decisions
3. **Hooks / notifications** — coordinator pushes on events (dependency ready,
   contract published, gate failed) via the board + MCP notification channel.

We are **not** cross-org, so full A2A isn't needed; the MCP tools + board are the
local equivalent. If a peer goes remote, expose the same calls as A2A with an
Agent Card — the data model already has the task/message shape.

## Enforced ownership

- On `launch`/`claim_task`, compute `claim_conflicts(scope)`; **reject** overlaps
  (Phase C already computes them — team mode flips warn → block).
- **Contract files** are single-owner: a task declares `contract`; the coordinator
  records the owner and `check_ownership` routes others to it.
- Worktrees remain the hard filesystem boundary (a blocked claim is defence #2).

## Verification pipeline

Per task: **gate → review → done**.

- **Gate** (automated): run the project's checks in the task's worktree on
  `complete_task`; failure keeps the task `working`.
- **Review** (independent): a task with `role: verifier` (different agent/model,
  read-only tools) checks the diff against `done_criteria`, posts a `review`
  message, approve/reject. Only green tasks merge.
- Merge only `done` tasks; the queue blocks on conflicts.

## Single | Team in the Code tab

A segmented control (next to the layout switch) swaps the surface, sharing all
state (sessions, worktrees, fleet, queue):

- **Single**: today's rail + terminals.
- **Team**: board (columns = task status; cards = tasks with role/agent/scope), a
  task detail (brief, done-criteria, diff, messages, gate results), a messages
  feed, and the merge queue. Terminal panes remain — one per working task.

"Team" is a **view over the same primitives**, not a second engine.

## Phased rollout

- **F1 — Team model.** `0006` tables; `Repo`/coordinator methods; `GET /team`,
  `POST /team` (launch), `PATCH /tasks/{id}`, `POST /tasks/{id}/complete|review`.
- **F2 — Task graph + gating.** Dependencies, blocked/unblock, auto-unblock,
  quality gate on completion.
- **F3 — Board.** `.contextgit/team.md` + `AGENTS.md` block; Single|Team UI.
- **F4 — MCP server.** stdio tools above; wire into the managed block + docs.
- **F5 — Verification gate.** Verifier role, review messages, merge only green.
- **F6 — Resources + cost.** Per-worktree `PORT`/env/DB offsets; per-task token
  budget, pause at 85%, kill after 3 stuck iterations.

## Risks

- **Over-engineering for small tasks** — cap at 3–5; Single stays the default.
- **Coordination overhead / cost** — token cost scales linearly; show + budget it.
- **Claims too strict** — allow an explicit override that records an event.
- **MCP tool sprawl** — keep a small, composable core.
- **Agent CLI variation** — board+file works everywhere; MCP is richer where supported.
- **Scope creep to cloud/A2A** — stay local-first; A2A only if a peer goes remote.

## Sources

- [Claude Code — Agent Teams](https://code.claude.com/docs/en/agent-teams)
- [MCP vs A2A (2026)](https://dev.to/pockit_tools/mcp-vs-a2a-the-complete-guide-to-ai-agent-protocols-in-2026-30li)
- [Agent workflow orchestration patterns: DAG / event-driven / actor](https://zylos.ai/research/2026-04-14-agent-workflow-orchestration-patterns/)
- [Context engineering for multi-agent systems (Atlan)](https://atlan.com/know/context-engineering/context-engineering-for-multi-agents/)
- [MCP developer guide 2026](https://essamamdani.com/blog/complete-guide-model-context-protocol-mcp-2026)
