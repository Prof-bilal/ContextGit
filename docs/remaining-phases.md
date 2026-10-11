# Remaining phases — endpoint graph, the "why" lens, and the backlog

> Status of the plan approved on 2026-10-07 (`~/.commandcode/plans/api-provenance-and-why.md`).
> Companion docs: [`api-db-clients.md`](./api-db-clients.md) (HTTP client, shipped),
> [`all-in-one-landscape.md`](./all-in-one-landscape.md) (the category and the gap).
> This file is the in-repo record of what is left, so the plan does not live only in
> one machine's `~/.commandcode/plans/`.

## Why this work exists

Two research rounds found the same hole in the market:

1. **Nothing couples API test generation to the version history of the code that
   created the endpoint.** Postman, Insomnia 12, Bruno AI, Hoppscotch, Keploy,
   Schemathesis, Dredd, Apidog, Skyramp, RoostGPT and ReadyAPI's MCP server are all
   spec-first, traffic-first or prompt-first — and history-blind. Commit-graph tooling
   (Datadog TIA, Launchable) only *selects* which existing tests to run. The nearest
   things to provenance (Docket's per-commit evidence, Zed's DeltaDB) do not do
   endpoint tests.
2. **"Why" is unowned.** Agent memory everywhere is hand-maintained markdown
   (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`, Cline's memory bank) that goes stale, and
   **none of it surfaces rejected alternatives**.

ContextGit already stores the raw material: commits pair messages + code,
`merge/semantic.py::extract_semantics` already returns `decisions`, `facts`,
`dead_ends`, `open_questions`, `conflicts`, sessions own worktrees and ports, gates
record their output, MCP tools and path claims exist. Competitors would have to build
the history engine first.

## Where we are

| Phase | Deliverable | Status |
|---|---|---|
| **A** | Endpoint graph with provenance | ✅ shipped 2026-10-07 |
| **B** | Boot the project's server, generate and run tests | ✅ shipped 2026-10-07 |
| **C** | Staleness, retirement, regression attribution | ✅ shipped 2026-10-07 |
| **D** | Rationale Blame — the "Why" lens | ✅ shipped 2026-10-07 |
| **E** | Memory that can't go stale, over MCP | ✅ shipped 2026-10-07 |
| **F** | Behavioral bisect + run replay | ✅ shipped 2026-10-07 |
| **DB** | Database client tab (Postgres + SQL Server + SQLite) | ✅ shipped 2026-10-07 |

**Every phase is now shipped.** There is no remaining work in this plan; the only open
items are the deferred backlog below and the two known limits noted under Phase F.

**Shipped so far (A + B)**

- `contextgit/endpoints/` — `discover.py` (OpenAPI, Python AST, Django, Express/Nest,
  Go), `provenance.py` (handler line → `git blame` → the run whose branch contains it →
  its conversation), `serve.py` (detect/boot/health/stop, live OpenAPI, crash
  diagnosis, port learned from the log, keeps probing so a nodemon restart is noticed),
  `tests.py` (generate → validate → repair once → real files).
- Routes: `GET/POST /api/v1/endpoints`, `GET/POST/DELETE /api/v1/endpoints/serve`,
  `GET /api/v1/endpoints/tests`, `POST /api/v1/endpoints/tests/{generate,run}`.
- New **Endpoints** tab (frozen tab pattern): rail with confidence filter and test
  badges, endpoint detail with request fields, an editable per-project server command,
  server log, and the **Origin** panel in the dock.
- Generated tests are ordinary pytest files in `<project>/tests/api/` that read
  `$API_BASE_URL` — CI-usable without ContextGit. Status lives in the local manifest
  `<project>/.contextgit/endpoints/suite.json` (a cache, never the source of truth).
- Tests: `tests/test_endpoints.py` + `tests/fixtures/{fastapi_app,express_app,go_app,django_app}`
  (10) and `tests/test_endpoint_serve.py` (21, including real uvicorn boot, crash
  reporting, port adoption, watcher recovery). Desktop e2e covers the tab.

## Phase C — Staleness, retirement, regression attribution ✅ shipped 2026-10-07

**What shipped.** Every generated test now carries the commit of *the handler it
verified* (`verified_at_commit`) and its handler location, and `staleness.annotate`
marks each one:

- **`fresh`** — the handler's newest commit is the one the test verified.
- **`stale`** — the handler changed since, with the reason naming the commit, its
  summary and the run behind it: *"The handler changed in 4f2a1c9 “switch auth to JWT”
  (run “checkout flow”) — re-run the tests to confirm the new behaviour."*
- **`retired`** — the endpoint is no longer in the project.
- **`untested`** — never ran, or the project isn't a git repo, so we cannot judge.

Routes: `POST /api/v1/endpoints/tests/reconcile` (all tests),
`GET /api/v1/endpoints/tests/staleness?project_path=&endpoint_id=` (one endpoint).
The Endpoints tab reconciles on load and after every run, shows `fresh`/`stale`/`retired`
chips plus the reason, and the rail badge turns amber/red for stale/retired. The toolbar
counts them ("· 2 stale").

**The bug this phase caught.** Tracking freshness by the *decorator line* alone meant a
change to the handler **body** — the common case — would not mark tests stale. Endpoints
now carry the handler's line *range* (`EndpointSource.line_end`, from the Python AST) and
`blame_span()` takes the newest commit across it, so any edit inside the handler counts.

**Tests.** `tests/test_endpoint_staleness.py` (7) — stale with reason, fresh, retired,
never-ran, the handler-vs-HEAD check against real git, and the two routes.

**Checkpoint.** Change an endpoint's handler, commit, and reload: its test goes `stale`
with the reason attached.

## Phase D — Rationale Blame (the "Why" lens) ✅ shipped 2026-10-07

**What shipped.** `git blame` answers *who* and *when*; this answers **why**.

- `contextgit/endpoints/why.py` — `why_history()` returns the timeline of a file's
  changes (pure git, no model), and `why_for()` joins the newest change to the recorded
  run whose branch contains it and extracts its reasoning by reusing
  `merge/semantic.extract_semantics` (the run's own messages, empty target).
- **Cached** per `(branch, base, head)` under `<project>/.contextgit/why/`, and a failed
  extraction is never cached — the model is asked at most once per change.
- Routes: `GET /api/v1/why?project_path=&path=&line=&as_of=&provider_id=` and
  `GET /api/v1/why/history?project_path=&path=`.
- UI: a new **Why** tab (frozen tab pattern) — the rail is the file's timeline (click a
  change to see it *as of* that commit), the view takes a `path` + `line`, and the dock
  shows the selected change's details. The Endpoints tab has a **"Why is this here?"**
  button that jumps to it with the handler's `file:line`.
- Degrades honestly: no provider, no recorded run, or an unknown path each produce a
  specific sentence instead of invented reasoning.

**The bug this caught.** `_run_for` matched any commit *contained in* a run's branch —
but a branch also contains everything that predates the run, so the run was credited with
code it merely inherited. Runs now only own commits they introduced (a commit reachable
from the session's `base_commit` is skipped). Also: `blame_span` picked the newest commit
via `git log --no-walk`, whose ordering ties when two commits share a timestamp — it now
picks by reachability, which is deterministic.

**Tests.** `tests/test_why.py` (6) — the timeline, extraction + **cache** (the provider is
called exactly once for two asks), no-provider honesty, untracked changes, and both
routes; plus a desktop e2e that reads a real file's history.

**Checkpoint.** Open Why on a file a run touched: you get its decisions, the rejected
alternatives and the open questions.

## Phase E — Memory that can't go stale, over MCP ✅ shipped 2026-10-07

**What shipped.** Seven MCP tools, all derived from the history — nothing hand-written:

| Tool | Answers |
|---|---|
| `memory(path?)` | The full bundle for the paths in scope |
| `dead_ends(path?)` | **What the team already rejected, with the reason** |
| `decisions(path?)` | The decisions made about these files, plus open questions and the runs behind them |
| `why(path, line?, as_of?)` | Why one file or line exists (Phase D, over MCP) |
| `endpoints(path?)` | The project's API surface, with the handler behind each route |
| `endpoint_tests(path?)` | The generated tests, and whether they are still true (pass/fail + fresh/stale/retired) |

**Scoping.** With no argument each tool answers for the caller's own task scope
(`CONTEXTGIT_TASK` → the task's `scope`, or its contract); a scope like `src/auth/**` is
expanded to the files it currently matches (build output and `node_modules` skipped), and
a path can always be named explicitly. `contextgit/memory/bundle.py` does the work: blame
each file → the run that introduced each change → that run's extracted decisions/dead
ends (Phase D, **cached**, so the model is asked at most once per change) — then flattens
and de-duplicates across runs.

**The `AGENTS.md` block now carries an "Already rejected here" section**, so the memory
reaches every CLI, MCP or not. It is deliberately **cache-only**: `repo.sync_agent_context`
will not spend an LLM call when a run starts, so the section appears once the reasoning
has been extracted (the Why tab, or an MCP call) — never as a surprise cost.

**Tests.** `tests/test_memory.py` (7) — glob expansion and skipping build output, scoping
(a path no run touched returns nothing rather than someone else's reasoning), the cache
(the provider is called exactly once across repeated asks), the task-scope path, the
`AGENTS.md` section appearing only after extraction, and the endpoint/why tool shapes.
`tests/test_mcp.py` gains a registration test asserting all six memory tools are exposed
and that `dead_ends`' description tells the agent what it is for.

**Checkpoint.** Ask an agent what was already rejected for the files it owns — it gets the
dead ends, with reasons, from the actual conversations.

## Phase F — Behavioral bisect + run replay ✅ shipped 2026-10-07

**What shipped.**

*Behavioral bisect* (`contextgit/verify/bisect.py`). `git bisect` tells you which commit
broke it; this tells you **which run, and what it decided**:

- `bisect_gate(repo, project, good=, bad=, command=)` walks the first-parent line between
  two commits, probing the middle each time — **each probe in a throwaway
  `git worktree`** under `<project>/.contextgit/bisect/`, removed immediately after, so
  the user's checkout is never touched and nothing is left behind.
- It checks both ends first (a "good" that already fails, or a "bad" that passes, is
  reported instead of bisected), caps the probes, and lands on the **first failing
  commit** with its message.
- Then it **attributes** that commit: `_run_for` names the run behind it and
  `reasoning_for` attaches its decisions and dead ends (cached, Phase D). So the answer is
  "this broke in `4f2a1c9` *'raise the value'*, from the run *'auth work'*, which had
  already rejected server-side sessions" — not just a hash.
- `oldest_commit()` provides the fallback "good" when the caller has none.

*Run environments* (migration **`0016_run_env.sql`**, `contextgit/verify/env.py`).
Every run now records what it could see: variable **names and hashes — never values** —
from `.env`, `.env.local`, `.env.development`… (later files win) plus a small set of
process keys (`NODE_ENV`, `PORT`, …). `repo.env_drift(a, b)` then answers *"why did this
work yesterday?"* with added / removed / changed keys. The capture is best-effort and
happens when the run is created, so it can never stop a run from starting.

**Routes + UI.** `POST /api/v1/endpoints/tests/bisect` (defaults: `bad` = HEAD, `good` =
the commit the endpoint's test last passed at, `command` = the project's detected gate).
The Endpoints tab shows a **"What broke it?"** button on any stale or failing test, and
prints the culprit, its run, the decisions and dead ends *from that run*, and any
environment drift between runs.

**Tests.** `tests/test_bisect.py` (7) — env parsing/hashing/source precedence, drift
(add/remove/change), a run recording its own environment and drifting from an earlier one,
**a real bisect over a real repository** (four commits, a regression at the third: the
culprit is found in ≤4 probes, the checkout is left clean), the not-bracketed and
no-command cases, and the route.

**Checkpoint.** Break something, commit it, and ask the tab what broke it: you get the
commit, the run, its reasoning and the environment difference.

## Phase DB — Database client tab ✅ shipped 2026-10-07

**What shipped.** A new **Database** tab: connect, browse the schema, run statements.

- `contextgit/dbclient/adapters.py` — one interface over **SQLite** (stdlib, always
  available), **Postgres** (psycopg 3) and **SQL Server** (pymssql). Drivers are imported
  **lazily**, so a missing one is a readable message (`pip install "contextgit[db]"`), and
  `GET /api/v1/db/drivers` tells the UI which engines this install can use.
- **Read-only is the default**, enforced *before* the server sees anything
  (`is_write()`), and results are capped (500 by default, 5000 hard) with the row count
  and a `truncated` flag.
- **Passwords are never stored.** Connection specs (engine, host, database, user,
  read-only) are files in `<repo>/db/` — shareable and versionable, like API collections.
  A password travels with the request that opens the connection, lives in memory with the
  driver handle, and dies with it.
- `contextgit/dbclient/store.py` — `ConnectionStore` (files) and `ConnectionRegistry`
  (live handles keyed by id, so the UI can reuse and close them).
- Routes: `GET /api/v1/db/drivers`, `GET|PUT|DELETE /api/v1/db/connections[/{name}]`,
  `POST /api/v1/db/open`, `DELETE /api/v1/db/open/{id}`, `GET /api/v1/db/schema`,
  `POST /api/v1/db/query`.
- UI: connection form (engine picker, engine-specific fields, read-only toggle, Save /
  Connect), schema tree in the rail (click a table to write a `SELECT`), query editor
  (⌘↵ runs) and a sticky-header results grid with timing and the truncation note.

**The bug the e2e caught.** FastAPI serves each request on a threadpool thread, so a
SQLite handle created by `/db/open` was used from a different thread by `/db/query` —
*"SQLite objects created in a thread can only be used in that same thread"*. The unit
tests passed because they stayed on one thread. Fixed properly: `check_same_thread=False`
for SQLite and a **lock per handle held by a template method** (`tables`/`query`/`close`
take the lock and delegate to `_tables`/`_query`/`_close`), so every engine is serialised
the same way.

**Tests.** `tests/test_dbclient.py` (12) — write detection (including `WITH … DELETE`), a
real SQLite round-trip with capping, the read-only refusal leaving data untouched, the
store (files, no secrets, name safety), the registry lifecycle, the missing-driver
messages, and the routes. Plus a desktop e2e that connects to a real SQLite file, runs a
query, sees the row, and saves the connection.

**Checkpoint.** Point it at a SQLite file and browse it — or at Postgres/SQL Server once
the extra is installed.

## Deferred backlog (not in the phase list)

| Item | Notes |
|---|---|
| **Git Graph extension** | The bundled `contextgit-graph` webview covers history today; the third-party Graph extension from Open VSX was deliberately deferred. |
| **Marketing suite** | Analytics / SEO / social / email (Umami, Plausible, Lighthouse, Postiz, Listmonk) — catalogued, not started. |
| **Docker + utilities** | Catalogued in `all-in-one-landscape.md`; no decision yet. |
| **Polish** | ⌘K command palette exists; global search, settings surface and detached panels are partial. |

## Open questions (answer when we reach the phase)

1. Phase E — expose the endpoint graph to the CLI harnesses (`ctx endpoints`) as well as
   MCP, or MCP only?
2. Phase F — how long do we keep run environments before pruning them?
3. Phase D — should the *as of* slider be per file, or per branch (a whole-repo view)?

## Notes that will bite us

- **Migrations**: 0014 is the other agent's `session_trash`, 0015 is `http_history`.
  Anything new starts at **0016**, and `tests/test_storage.py` asserts the applied
  version list — it is shared, so update it in the same change.
- **Another agent owns the Git panel**: `desktop/src/shell/views/GitView.tsx`,
  `desktop/src/shell/rail/GitRail.tsx`, `desktop/src/shell/git/*`, `DeleteBranchDialog.tsx`
  and the git/commit endpoints. Do not edit them. Its e2e test
  (`a branch can be deleted, and the current one cannot`) currently fails and is theirs,
  not ours.
- **Generated tests must never guess a host.** They read `$API_BASE_URL` and nothing else;
  a file that hard-codes `127.0.0.1`/`localhost` is rejected at generation time, and the
  runner refuses to run at all when no server is healthy.
