# Phase 6 — Security, Correctness, and Performance Hardening

This phase follows the five-tab consolidation work. It is based on
`files/codebase-audit.md` (the repository's `codeaudit.md` equivalent) and
`bugs.md`.

## Goal

Make the local backend and desktop app safe to expose to the local machine,
then remove the highest-risk correctness and performance traps. Every confirmed
finding gets a regression test before or with its fix.

## Scope and order

### 6A — Close the security boundary first

- Make API authentication fail closed for standalone and desktop launches:
  require `CONTEXTGIT_API_TOKEN` on every route, use constant-time bearer-token
  comparison, and keep the desktop token private to the preload/main boundary.
- Replace broad localhost/`null` CORS with exact allowed origins. Keep the
  bearer token as the actual protection against opaque-origin requests.
- Remove raw shell execution from endpoint serving, quality gates, and generated
  test execution. Use argv-form subprocesses and a detected/explicitly approved
  command allow-list.
- Enforce read-only database connections at the adapter/server level, reject
  multi-statement read queries, and cap result fetching with `fetchmany`.
- Add SSRF protection to the research fetcher and HTTP client: allow only HTTP(S),
  reject loopback/private/link-local destinations, and re-check redirects.
- Escape all model/commit/branch/error data rendered by the VS Code extension.
- Harden Electron boundaries: restrict PTY commands and environment keys,
  allow-list external URL schemes, validate save-file names, add a strict CSP,
  and remove `ctxasset` CSP bypass where possible.
- Protect the editor sidecar with a per-launch connection token and restore
  workspace trust where compatible.
- Set database file permissions to `0600` and reduce provider key hints.

### 6B — Prevent hangs, races, and data loss

- Serialize SQLite access or use a safe connection strategy; enable WAL,
  `synchronous=NORMAL`, and a busy timeout.
- Fix council streams so every member emits a terminal event and cancelled tasks
  are awaited. Surface research/provider failures instead of returning empty
  successful artifacts.
- Make branch-head updates compare-and-swap operations and retry/report
  conflicts rather than dropping concurrent commits.
- Fix merge integration to use one captured target SHA for merge-tree and CAS,
  and preview context conflicts before moving the code ref.
- Require `review` plus a passing gate before task approval; prevent direct
  PATCH transitions to `done`.
- Populate normal commit token counts and fix the custom-provider update fallback
  so omitted fields preserve stored values.
- Reset stale supervisor crash state on restart, fix repo initialization races,
  and map missing CLI capabilities to a client error.
- Validate document IDs, branch/base refs, collection names, test filenames, and
  generated-test entry points with explicit validation rather than `assert` or
  shell interpolation.

### 6C — Reduce avoidable work

- Make commit listing single-pass instead of O(N²), and avoid returning every
  message body in every repo snapshot.
- Cache or batch repeated commit, workspace-status, project-discovery, and asset
  index reads.
- Gate desktop polling by active tab and document visibility.
- Reduce terminal scrollback, make screen-reader mode opt-in, and unmount hidden
  panes where this does not interrupt active PTYs.
- Add static export and self-hosted fonts for the landing page; remove the root
  `@xyflow/react` dependency if it remains desktop-only.

### 6D — Make the quality gates enforceable

- CI must run pytest, ruff, strict mypy, root TypeScript checks, desktop typecheck,
  and desktop build.
- Add a Python lockfile or an explicitly documented reproducible dependency
  strategy.
- Add regression coverage for every fixed S/B/A/P finding, with concurrency tests
  for SQLite, commits, merges, council, and task approval.

## Deferred after the hardening baseline

The `Repo`/API god-object split, broad retry/token helper deduplication, retention
and garbage collection, code-server packaging/signing, and removal of historical
dead documentation are separate follow-up work. They should not delay the
security and correctness baseline.

## Acceptance criteria

1. Unauthenticated, cross-origin, shell-command, SSRF, read-only DB, XSS, and
   PTY regression tests fail closed.
2. Concurrent commit/merge/database tests preserve every commit and never leave
   a partially applied integration.
3. Council/research failures terminate with an explicit error event.
4. `pytest`, `ruff`, strict `mypy`, root `tsc`, desktop `npm run build`, focused
   Electron e2e tests, and the existing desktop lifecycle/markdown tests pass.
5. No confirmed HIGH or CRITICAL finding remains without either a fix or an
   explicitly documented design decision.

