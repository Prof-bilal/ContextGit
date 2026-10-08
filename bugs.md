# Backend bug report

Scope: the Python backend in `contextgit/` (FastAPI API, `core/`, `storage/`,
`gitops/`, `integration/`, `dbclient/`, `research/`, `limits/`, `llm/`, `mcp/`,
`endpoints/`, `verify/`, `apiclient/`, `documents/`). The Electron/TypeScript
desktop app is out of scope except where it changes backend exposure.

## Method

- Read the API surface (~100 routes), `Repo`, SQLite storage, git ops, the
  integration service and runners, DB adapters, endpoint test/server
  supervisor, research engine, limits adapters, and the MCP tools.
- Grepped for risky patterns: `shell=True`, raw SQL, blocking calls, broad
  `except`.
- Ran the existing test suite: **all tests pass**, so the findings below sit in
  paths the suite does not cover.
- Reproduced the items marked **[reproduced]** with small scripts against the
  real code. Items marked **[code-verified]** follow directly from the code but
  were not run. Items marked **[needs repro]** are plausible but unconfirmed.

## Summary

| ID  | Severity | Area        | Title                                                     | Status            |
|-----|----------|-------------|-----------------------------------------------------------|-------------------|
| S1  | High     | Security    | Unauthenticated shell execution via `/endpoints/serve`    | code-verified     |
| S2  | High     | Security    | "Read-only" DB connections can be written                 | **reproduced**   |
| S3  | High     | Security    | SSRF in research page fetcher                             | code-verified     |
| S4  | Medium   | Security    | Generated test code runs behind a weak blacklist          | code-verified     |
| S5  | Medium   | Security    | Provider API keys stored in plaintext                     | code-verified     |
| S6  | Low      | Security    | Test filenames are shell-joined                           | code-verified     |
| B1  | High     | Team/tasks  | Approving a task skips review and its gate                | **reproduced**   |
| B2  | High     | Core        | Concurrent commits on one branch lose a commit            | code-verified     |
| B3  | High     | Git         | Merge race can silently drop target-branch changes        | code-verified     |
| B4  | High     | Storage     | One SQLite connection shared across threads, no lock      | code-verified     |
| B5  | Medium   | Core        | `integrate_run` merges code before checking context       | code-verified     |
| B6  | Medium   | Core        | Stored `token_count` is 0 for every normal commit         | **reproduced**   |
| B7  | Medium   | Core        | `commits` listing is O(N²)                                | code-verified     |
| B8  | Medium   | Verify      | Gate timeout can hang the worker                          | code-verified     |
| B9  | Medium   | Providers   | Editing a custom provider drops its base URL              | **reproduced**   |
| B10 | Medium   | DB client   | Table list crashes on a table with a quote in its name    | **reproduced**   |
| B11 | Medium   | DB client   | Query fetches every row before applying the cap           | code-verified     |
| B12 | Medium   | Server      | Crash state from a previous run is never cleared          | code-verified     |
| B13 | Medium   | Server      | Status polls rescan the whole project under a lock        | code-verified     |
| B14 | Medium   | Research    | LLM failures silently produce empty results               | code-verified     |
| B15 | Medium   | Integration | Missing CLI returns 500, not 409                          | code-verified     |
| B16 | Medium   | Git         | Non-ASCII/special file names break change tracking        | code-verified     |
| B17 | Medium   | Git         | `base_ref` is passed to git unchecked                     | code-verified     |
| B18 | Medium   | Limits      | Cline shows a real zero balance as "unknown"              | **reproduced**   |
| B19 | Medium   | API         | `POST /repo/init` is unreachable after any other request  | code-verified     |
| B20 | Medium   | Integration | Stale job copy overwrites fields written concurrently     | code-verified     |
| B21 | Low      | Core        | Collection and connection names accept a trailing newline | **reproduced**   |
| B22 | Low      | Core        | Branch-name validation is weaker than git's rules         | code-verified     |
| B23 | Low      | Core        | Session creation can leave an orphan branch               | code-verified     |
| B24 | Low      | Core        | Port allocation is off by one and never checks the OS     | code-verified     |
| B25 | Low      | Team        | Done tasks keep file claims, blocking later overlaps      | needs repro      |
| B26 | Low      | Team        | `limit=0` returns the whole board                         | code-verified     |
| B27 | Low      | Team        | `publish_contract` escapes the error guard                | code-verified     |
| B28 | Low      | Core        | Purging a branch leaves its runs dangling                 | code-verified     |
| B29 | Low      | Server      | Live OpenAPI is never used for monorepo layouts           | code-verified     |
| B30 | Low      | Core        | Merge commit token count excludes the merge itself        | code-verified     |
| B31 | Low      | Limits      | Limit waiters can hang if the owner fails early           | code-verified     |
| B32 | Low      | API         | `usage?days=0` is treated as "all time"                   | code-verified     |
| B33 | Low      | Verify      | Usage backfill re-runs on every call until usage exists   | code-verified     |

---

## Security

### S1. Unauthenticated shell execution through `/api/v1/endpoints/serve` (High)

`POST /api/v1/endpoints/serve` takes a `command` string and
`ServerSupervisor.start` runs it with `subprocess.Popen(..., shell=True)`
(`contextgit/endpoints/serve.py`). The bearer-token middleware is enforced only
when `CONTEXTGIT_API_TOKEN` is set (`contextgit/api/app.py`), and it is unset by
default for a standalone server. CORS only restricts which origins may *read*
responses, so a request that needs no preflight (a simple cross-origin POST) can
still run the command. FastAPI parses JSON bodies without enforcing
`Content-Type` (verify this in your FastAPI version).

- Impact: any local web page can run arbitrary commands as the user while the
  standalone API is running. The desktop app sets a per-launch token, which
  blocks this path, so the risk is for standalone and dev use.
- Fix: fail closed. Require the token on every mutating route, or refuse to
  start without one. Reject requests whose `Origin` is not the app. Restrict
  `command` to the detected command, or require a confirmation step.
- Note: the integration routes already fail closed (`contextgit/integration/api.py`),
  so the rest of the API should match.

### S2. "Read-only" database connections can be written (High) [reproduced]

`dbclient/adapters.py::is_write` is a prefix regex, so these statements pass the
guard on a read-only connection:

```
is_write("SELECT 1; DELETE FROM t")        -> False   # multi-statement
is_write("EXPLAIN ANALYZE DELETE FROM t")  -> False   # executes the DELETE on Postgres
is_write("/* x */ DELETE FROM t")          -> False   # leading comment
```

Postgres runs with autocommit and no read-only session setting, and psycopg
accepts multiple statements in simple queries, so a "read-only" Postgres
connection can be written. The SQLite adapter also opens the file read-write
even when `readonly` is set.

- Fix: enforce read-only on the server (`SET SESSION CHARACTERISTICS AS
  TRANSACTION READ ONLY` for Postgres, `mode=ro` URI for SQLite, read-only login
  for SQL Server). Reject multiple statements. Use an allowlist (`SELECT`, `WITH`
  without DML, `SHOW`, `EXPLAIN` without `ANALYZE`) on top of that.

### S3. SSRF in the research page fetcher (High) [code-verified]

`research/fetch.py::Fetcher.fetch` fetches any URL that search returns, with
`follow_redirects=True`. There is no check for loopback, private, or link-local
addresses, so a result pointing at `169.254.169.254` or `127.0.0.1` gets fetched.
Search results are third-party data, so this is reachable.

- Fix: resolve the host and block private, loopback, and link-local ranges.
  Re-check every redirect target. Restrict schemes to `http` and `https`.

### S4. Generated test code runs behind a weak blacklist (Medium) [code-verified]

`endpoints/tests.py::validate_source` rejects a few substrings (`subprocess`,
`os.system`, `eval(`, ...). It does not block `importlib`, `os.popen`, or
`open(..., "w")`. The prompt includes project source, so a malicious comment in a
handler can steer the model. The generated file is then executed with pytest as
the user.

- Fix: run generated tests in a sandbox or a throwaway container. Restrict the
  network to `API_BASE_URL`. Require user approval before first execution.
  Don't describe the blacklist as a sandbox.

### S5. Provider API keys are stored in plaintext (Medium) [code-verified]

`providers.api_key` is written unencrypted to the repository database
(`storage/sqlite.py::_upsert_provider_row`). The database lives in the project
directory. Also, `key_hint` shows `key[:3]…key[-4:]`, which reveals 7 of 9
characters for a 9-character key.

- Fix: store secrets in the OS keychain, or encrypt them with a key outside the
  repo. Show a fixed-length hint, or none for short keys.

### S6. Test filenames are shell-joined (Low) [code-verified]

`endpoints/tests.py::run_suite` builds `pytest {' '.join(files)}` and passes it
to `shell=True`. A file named with shell metacharacters in `tests/api/` breaks
out. Pass an argument list, or quote each path.

---

## Correctness: team, core, and git

### B1. Approving a task skips review and its gate (High) [reproduced]

`Repo.approve_task` marks a task `done` from any non-done status. A task that was
never started, or whose gate failed, can be approved, and its dependents start
immediately. The task PATCH route also accepts `status: "done"` directly
(`Repo.update_task`), which bypasses the same checks.

```
task = repo.create_task(team.id, title="never started")
repo.approve_task(task.id).status   # -> "done"
```

- Fix: `approve_task` should require `review` (and a passing gate when one is
  configured). Remove `done` from the PATCH status options, so approval goes
  through the approve path only.

### B2. Concurrent commits on one branch lose a commit (High) [code-verified]

`Repo.commit` reads the branch head, inserts the commit, and then calls
`update_branch_head` unconditionally. Two requests on the same branch (for
example a chat and a council run) can both start from the same head. The second
update overwrites the first, and that first commit becomes unreachable from the
branch.

- Fix: make the head update a compare-and-swap (`UPDATE branches SET
  head_commit_id=? WHERE name=? AND head_commit_id=?`), check the row count, and
  retry or raise on conflict.

### B3. Merge race can silently drop target-branch changes (High) [code-verified]

`gitops/integrate.py::_integrate` computes `merge_tree(project, target, branch)`
first, and only then reads `old = git.rev_parse(target)` for the compare-and-swap
in `update-ref`. If the target moves between those two steps, the new merge
commit gets the newer target as a parent, but its tree is built from the older
target. The changes made in between are then lost, and the CAS succeeds. The
`target_commit` parameter exists for this purpose, but `integrate()` never passes
it.

- Fix: read the target SHA once, before the merge. Merge against that SHA and
  use the same SHA for the CAS. Pass it through `target_commit`.

### B4. One SQLite connection is shared across threads without a lock (High) [code-verified]

`storage/sqlite.py::SqliteStorage` opens a single connection with
`check_same_thread=False`. FastAPI runs sync routes on a thread pool, and nothing
serializes access. Interleaved `with self._conn:` transactions can commit or roll
back each other's work, and sqlite3 can report "cannot start a transaction within
a transaction".

- Fix: serialize all access with a lock, or use a connection per thread or a
  small pool with WAL mode. Add a regression test that runs concurrent commits.

### B5. `integrate_run` merges code before checking context (Medium) [code-verified]

`Repo.integrate_run` calls `integrate()` (which moves the git target ref) before
it previews the context merge. If the preview has conflicts, `MergeConflict` is
raised after the code has already landed, and the caller sees an error for a
partly applied operation.

- Fix: run the context preview and conflict check first, then integrate code, or
  compensate on failure.

### B6. Stored `token_count` is 0 for every normal commit (Medium) [reproduced]

`Repo.commit` never sets `token_count`, so it stays at the column default of 0.
Only merge commits set it. `Repo._task_tokens` sums `commit.token_count`, so the
task context meter reads 0 for almost every run.

```
commit = repo.commit([Message(role="user", content="x"*400)], model="m")
repo.get_commit(commit.id).token_count   # -> 0
```

- Fix: compute `token_count` in `commit()` (for example via `count_tokens`), or
  compute it on read.

### B7. `commits` listing is O(N²) (Medium) [code-verified]

`GET /api/v1/commits` calls `build_context(commit.id)` and `count_tokens` for each
commit. Each call walks the whole ancestry, so listing N commits reads on the
order of N² rows. Large histories will be slow.

- Fix: compute context length and token count once per commit, incrementally from
  the parent, and cache the results.

### B8. Gate timeout can hang the worker (Medium) [code-verified; needs repro]

`verify/runner.py::run_command` runs `shell=True` and `subprocess.run(timeout=...)`
without a new process group. On timeout, Python kills only the shell. A grandchild
that still holds stdout keeps the pipe open, so the follow-up `communicate()` can
block indefinitely. Compare `serve.py` and `integration/runners.py`, which kill the
whole process group.

- Fix: start the command in its own session and kill the group on timeout, as the
  other runners do.

### B9. Editing a custom provider drops its base URL (Medium) [reproduced]

`api/app.py::_provider_record` takes `base_url` from the request or the built-in
spec, and never from the stored row. Rotating only the key on an existing custom
provider fails.

```
POST /api/v1/providers  {"id": "my-llm", "api_key": "new"}
-> ProviderConfigError: a custom provider needs a base URL
```

The same function also resets `label`, `vendor`, `models`, and `default_model`
to defaults when they are omitted.

- Fix: fall back to `existing` for every field before the built-in defaults.

### B10. Table listing fails on a table name containing a quote (Medium) [reproduced]

`dbclient/adapters.py::SqliteAdapter._tables` runs
`PRAGMA table_info("{name}")` with string formatting. A name containing `"`
raises `OperationalError`, which is not converted to `DbError`, so the whole
schema call returns 500.

- Fix: escape the identifier (double the quotes), or use
  `SELECT * FROM pragma_table_info(?)` with a bound parameter.

### B11. Query fetches every row before applying the cap (Medium) [code-verified]

All adapters call `cursor.fetchall()` and then slice to the cap. `SELECT * FROM
big_table` loads the whole table into memory. The "results are capped" guarantee
only covers the output, not the fetch.

- Fix: use `fetchmany(cap + 1)` and report truncation from that.

### B12. A crash from an earlier run is never cleared (Medium) [code-verified]

`ServerSupervisor.start` resets the log and error, but not `_fatal` or
`_announced_port`. After one crash, the next start sees the old fatal signature
and reports a crash straight away, even if the new server is fine. A stale
announced port can also override the port.

- Fix: reset `_fatal`, `_announced_port`, and `_healthy` at the start of `start()`.

### B13. Status polls rescan the whole project under a lock (Medium) [code-verified]

`ServerSupervisor.status(project)` calls `detect_run_command`, which calls
`python_app_target`. That runs `root.rglob("*.py")` over the whole tree, including
`.venv` and `node_modules`, and filters skipped directories only after the walk.
It also runs under the supervisor lock, so each poll blocks other requests.

- Fix: prune directories during the walk (`os.walk` with an in-place `dirs`
  filter), cache detection results, and run detection outside the lock.

### B14. LLM failures silently produce empty research results (Medium) [code-verified]

`research/engine.py::_structured` catches provider exceptions and returns an empty
`schema()`. The run then completes and saves an empty report, and the user sees no
error.

- Fix: propagate the error to the stream, so the UI reports the failure.

### B15. Missing CLI returns 500 instead of 409 (Medium) [code-verified]

`CLIRunner.capability` runs `codex app-server --help`. A non-zero exit raises
`InvocationFailed`, which is a `RuntimeError`. `integration/api.py::call` only
maps `ValueError` to 409, so the route returns 500.

- Fix: raise `ValueError` for capability failures, or map `InvocationFailed` to
  409 in `call`.

### B16. Non-ASCII and special file names break change tracking (Medium) [code-verified]

`gitops/repo.py::Git.changed_files` uses `git diff --name-only` and
`git ls-files` without `-z`. Git quotes non-ASCII and special paths by default,
so the overlap and claim checks compare quoted strings. `Git.run` also decodes with
`text=True`, which can raise on non-UTF-8 paths.

- Fix: use `-z` and split on NUL, and decode as bytes or with `errors="replace"`.

### B17. `base_ref` is passed to git unchecked (Medium) [code-verified]

`Repo._resolve_base` returns any `base_ref` as-is, and `WorktreeManager.create`
passes it positionally to `git worktree add`. A value starting with `-` is parsed
as an option. Only `_check_ref_name` in `branch()` validates names, and it is not
applied here.

- Fix: validate `base_ref` with `git check-ref-format`, resolve it with
  `rev-parse --verify`, and insert `--end-of-options` before user input.

### B18. Cline shows a real zero balance as "unknown" (Medium) [reproduced]

`limits/cline.py::_credits_from` uses `x or y` fallbacks. A balance of `0` is
falsy, so it falls through to `None`.

```
_credits_from({"credits": {"monthlyRemaining": 0, "purchasedRemaining": 0}}) -> None
```

An account that is out of credits looks the same as an account with no data.

- Fix: test for `None` explicitly, not truthiness.

### B19. `POST /api/v1/repo/init` is unreachable after any other request (Medium) [code-verified]

`get_repo()` creates and caches a repository on the first repo-dependent request.
`init_repo` then checks `"repo" in state` and raises `RepoAlreadyExists`. So
initializing a chosen path only works if it is the first request to the server.
Confirm the desktop flow before treating this as user-facing.

- Fix: either drop the auto-create for `init`, or allow re-init to a new path
  when the old repository is empty.

### B20. Stale job copies overwrite concurrent updates (Medium) [code-verified]

`integration/service.py::IntegrationService.save` writes the whole in-memory job
dict back. A worker that loaded the job earlier can overwrite fields written
concurrently by another call. For example, a second `ready(session, task_id)` sets
`task_id` in the database, and the worker's next save resets it to `None`. The
finished task then never gets approved.

- Fix: update only the fields that changed, or re-read and merge inside the lock.

### B21. Names accept a trailing newline (Low) [reproduced]

`apiclient/store.py::CollectionStore._NAME` and `dbclient/store.py::_NAME` use
`re.match` with `$`, which also matches before a trailing `\n`.
`CollectionStore._path("abc\n")` returns `abc\n.json`.

- Fix: use `re.fullmatch` or `\Z`.

### B22. Branch-name validation is weaker than git's rules (Low) [code-verified]

`Repo._check_ref_name` rejects only a few characters. `..`, `@{`, a `.lock` suffix,
and `//` pass. Git rejects these later, after the branch row has already been
written.

- Fix: validate with `git check-ref-format --branch` before writing.

### B23. Session creation can leave an orphan branch (Low) [code-verified]

`Repo.create_session` creates the branch row before `_attach_worktree`. If the
worktree step fails, the branch remains with no session.

- Fix: create the worktree first, or roll back the branch on failure.

### B24. Port allocation is off by one and never checks the OS (Low) [code-verified]

`Repo._next_port` returns `max(used) + 1`, so the first run gets `base + 1`, which
contradicts the comment. It also doesn't check whether the port is free.

- Fix: return `base` for the first run, and skip ports the OS reports as in use.

### B25. Done tasks keep file claims (Low) [needs repro]

Claims are only deleted when a session is deleted. A task that is done keeps its
claims, so a later task that overlaps its scope gets `ScopeConflict` from
`start_task`, and `approve_task` then sets the dependent to `blocked` with no path
to recover. This may be intended. Decide the policy and document it.

### B26. `limit=0` returns the whole board (Low) [code-verified]

`messages[-limit:]` with `limit=0` returns the full list. This affects
`storage/sqlite.py::list_team_messages`, `mcp/tools.py::read_board`, and the
`/team/messages` route.

- Fix: treat `limit <= 0` as "no messages" or clamp it.

### B27. `publish_contract` escapes the error guard (Low) [code-verified]

`mcp/tools.py::publish_contract` calls `repo.get_task` outside `_guard`, so an
unknown task id raises through the MCP transport instead of returning a readable
error.

- Fix: wrap the lookup in `_guard`.

### B28. Purging a branch leaves its runs dangling (Low) [code-verified]

`Repo.purge_branch` drops the branch without checking sessions that reference it
by name. Those sessions then fail with `BranchNotFound`.

- Fix: refuse to purge a branch that a live run uses, or detach the run.

### B29. Live OpenAPI is never used for monorepo layouts (Low) [code-verified]

`api/app.py::_live_openapi` requires `status.cwd == str(root)`. When detection
runs the server in a subdirectory (`backend/`), the check fails and the live spec
is never used.

- Fix: check that `cwd` is inside `root`, not equal to it.

### B30. Merge commit token count excludes the merge itself (Low) [code-verified]

`Repo.apply_merge` calls `count_tokens(preview.target_head_id, model)`, which
counts the target branch only, not the merged context.

- Fix: count the merge commit's own context.

### B31. Limit waiters can hang if the owner fails early (Low) [code-verified]

In `limits/registry.py::_read`, a waiter blocks on `future.result()`. If the owner
thread raises before `set_result`, the future is never resolved.

- Fix: set an exception on the future in a `finally`, or use a timeout.

### B32. `usage?days=0` means "all time" (Low) [code-verified]

`if days:` treats 0 as no filter. Negative values produce a future cutoff.

- Fix: validate `days >= 1` and return a 422 otherwise.

### B33. Usage backfill re-runs on every call until usage exists (Low) [code-verified]

`Repo.backfill_usage` returns early only when usage events exist. If the history
has no billable commits, every `usage_summary` call re-walks every branch.

- Fix: record a "backfilled" marker.

---

## Not covered in this pass

These areas were not reviewed in depth: `documents/` (renderers and generation),
`memory/bundle.py`, `endpoints/why.py`, `endpoints/provenance.py`,
`endpoints/discover.py`, `endpoints/staleness.py`, `merge/engine.py`,
`merge/semantic.py`, `cli/main.py`, `gitops/context.py` and `gitops/status.py`,
`core/team.py`, `verify/env.py` and `verify/detect.py`, `research/store.py`,
`llm/anthropic.py`, `llm/search.py`, `llm/images.py`, `llm/spec.py`,
`mcp/config.py`, and the Freebuff and Command Code limits adapters. The
TypeScript desktop app was also not reviewed. A second pass on these would be
worthwhile.
