# Optimization plan — keep the machine fast, disk and RAM low

**Prepared:** 2026-10-07
**Goal (user's words):** make ContextGit the **all-in-one** app that *doesn't* make the laptop
hang — low disk, low memory, no runaway processes. "Users see everything, and their PC disk or
memory never gets high."
**Companions:** `files/codebase-audit.md` §C (the measured findings), `files/monetization-strategy.md`
(cloud agents as the paid "offload your laptop" play).

This document is in two parts:
- **Part A — internal optimizations** (make the app lean).
- **Part B — the in-app Resource monitor** (let users see and reclaim usage).

---

## Part A — Internal optimizations

Prioritized by impact on the "laptop hangs" complaint. Every item cites the code location from
`files/codebase-audit.md`.

### A1. RAM in the renderer (biggest lever) — audit P11/P12
- **xterm buffers:** `desktop/src/shell/terminal/TerminalPane.tsx:175-176` sets
  `screenReaderMode: true` and `scrollback: 10000` **per pane**. `screenReaderMode` builds a
  hidden DOM mirror of the entire buffer (real CPU/RAM per pane). → lower scrollback to
  **1000–2000**, make `screenReaderMode` **opt-in**, and add a "reduce scrollback" default for
  low-memory machines.
- **Unmount inactive panes:** `desktop/src/shell/terminal/PaneCanvas.tsx` renders a live
  `TerminalPane` (PTY + xterm + WebGL context) for **every open run**, hidden ones included.
  → keep the PTY alive but **detach/unmount the xterm view** for non-visible panes; reattach on
  show (scrollback is preserved server-side in the PTY's `deque(maxlen=400)`).
- **Code-split tabs:** `desktop/src/shell/Shell.tsx` statically imports ~50 modules; only
  GitView's charts + terminal are `React.lazy`. → `React.lazy` **every** per-tab view so first
  paint only parses the active tab.
- **Idle-unload heavy views:** Browser and Editor are kept mounted forever (`Shell.tsx`
  2089-2104) to survive tab switches. → add an idle timeout that destroys the
  `WebContentsView`/editor view after N minutes hidden, and re-create on return
  (`viewmanager.ts:destroy(id)`, `editor.stop()` already exist).
- **Browser partition:** `viewmanager.ts:66` uses `partition: "persist:browser"` → browsing
  state/caches accumulate. → use a **non-persistent session** or explicit eviction.
- **Electron hygiene (official guidance):** `Menu.setApplicationMenu(null)` before ready;
  avoid synchronous IPC/`fs` in the main process; bundle; self-host fonts (kill the remote
  Google Fonts in `desktop/index.html`). Source: Electron Performance docs.

### A2. Idle CPU / process churn — audit P9/P13
- **Gate the pollers.** `useSessions` (4 s), `useFleet` (6 s), `useMergeQueue` (4 s),
  `useTrash` (4 s), `useTeam` (4 s) run **unconditionally**. → pause each unless its tab is
  active *and* `document.visibilityState === "visible"`.
- **Stop the git fan-out.** `/api/v1/fleet` → `Repo.fleet()` shells out to `git` ~5× **per run**
  every 6 s. → cache `workspace_status` server-side for a few seconds, and only compute when the
  Code/Fleet view is actually open.
- **Server status poll** (`useEndpoints`, 2 s) — already scoped; leave, but reuse the cache.

### A3. Backend speed / correctness — audit P4/P6/P8, A10
- **Enable WAL:** `storage/sqlite.py:65` sets only `foreign_keys`. →
  `PRAGMA journal_mode=WAL; synchronous=NORMAL; busy_timeout=5000`. Removes reader/writer
  stalls under the threadpool.
- **Fix O(N²) `/api/v1/commits`:** currently calls `build_context` twice per commit. → single
  pass + a per-request commit/message cache (P4/P7).
- **Stop re-sending everything:** `/api/v1/repo` returns *every commit with every message* and
  is refetched after each mutation. → return graph metadata; fetch message bodies lazily (P6).
- **Cache discovery:** `endpoints/discover.py:project_files` re-`rglob`s and re-`ast.parse`s
  every call. → mtime/size-keyed cache (P8).
- **Offload blocking work:** sync `Repo`/git calls run on the event loop inside streaming
  generators → `anyio.to_thread.run_sync` (A10).

### A4. Disk hygiene / GC (the "disk never gets high" lever) — audit P16
Nothing is ever reclaimed today. Add:
- **Retention/pruning** for append-only tables: `usage_events`, `http_history`,
  `team_messages`, `team_events` (age- or count-based, configurable).
- **`VACUUM` / `auto_vacuum`** on the SQLite DB (`<repo>/.contextgit/contextgit.db`).
- **GC unreachable commits** (deleted branches keep their commits; `all_commits()` returns them).
- **Clean worktrees on trash:** `Repo.trash_session` currently keeps the full checkout on disk
  (`core/repo.py` ~609; removal only happens on *permanent* delete). → remove the worktree's
  contents on trash (keep the branch), or offer it in the Resource monitor.
- **Prune artifacts:** `.contextgit/documents/`, `research/<run_id>/`, the asset library
  (`<userData>/assets/files` + `assets.json`) — no GC today.
- **Cache the asset index:** `desktop/electron/library.ts:filePath()` re-reads/parses all of
  `assets.json` per request (P14). → in-memory index, invalidate on write.
- **Stop re-copying code-server extensions** on every editor start (`main.ts:509-548` deletes +
  re-copies). → copy once, version-stamp.

### A5. Startup
- **PyInstaller `--onedir`** instead of `--onefile` (`desktop/scripts/build-backend.sh`) — no
  per-launch self-extraction.
- Warm the backend concurrently with first paint (already partly done); stagger non-critical
  work after first paint.

### A6. Guardrails (so it stays fast)
- A **memory budget test** in CI (launch with N panes/runs, assert RSS under a threshold) once
  the Resource monitor (Part B) exposes metrics.
- Lint rule / review checklist: no new unconditional `setInterval` pollers; no `shell=True`;
  no unbounded in-memory caches.

---

## Part B — The in-app "Resource monitor" feature

Directly answers "users see all thing and their pc disk aur memory never gets high."

### What it shows
1. **This app's footprint** — ContextGit's own processes and memory/CPU:
   - Electron main/renderer/GPU/utility processes via `app.getAppMetrics()` and
     `process.getProcessMemoryInfo()` (main process side).
   - A simple live chart (RAM + CPU), so the user *sees* whether ContextGit is the hog.
2. **Per-project storage** — a breakdown of `<project>/.contextgit/`:
   - `contextgit.db` (with row counts), `worktrees/`, `documents/`, `research/`, `assets/`,
     `security/`, caches — each with its size on disk.
   - Project totals across all remembered projects.
3. **One-click reclaim** — buttons wired to the Part-A GC:
   - **Vacuum database** · **Prune history (older than N)** · **Remove clean worktrees** ·
     **Clear caches** · **Prune old documents/research runs**.
   - Each shows the exact bytes it will free and requires confirmation.

### Where it lives
- Prefer a **"System" section inside the existing Storage tab** (Storage already owns trash +
  cleanup semantics, `StorageView.tsx`/`useTrash.ts`) rather than a new top-level tab — keeps
  the nav from growing and groups "reclaim space" with "trash."
- If a standalone view is preferred, it follows the standard tab wiring
  (`TopNav.tsx:3-16`; `Shell.tsx:102/1003/1077/1211/1730`).

### Backend
```python
# contextgit/api/app.py  (thin, read-only + explicit cleanup)
@app.get("/api/v1/resources", response_model=ResourcesSummary)
def resources(current: Repo = repo_dep) -> ResourcesSummary:
    """Disk/RAM footprint of this app + per-project storage breakdown."""

@app.post("/api/v1/resources/cleanup", response_model=CleanupResult)
def resources_cleanup(body: CleanupRequest, current: Repo = repo_dep) -> CleanupResult:
    """Run an explicit reclaim action (vacuum, prune, remove clean worktrees, clear caches)."""
```
- New package `contextgit/resources/` (or extend `storage/`): `sizes()` uses
  `os.scandir`/`os.stat` recursion (no `du` dependency) + DB row counts; `cleanup()` runs the
  Part-A GC actions and returns bytes freed.
- **Explicit and confirmed only** — never auto-delete user data without a click.
- Electron side feeds the process/CPU numbers to the renderer via a small IPC channel
  (existing `contextgit` preload bridge pattern).

### Why this is also a monetization feature
"ContextGit is the one dev app that keeps your laptop cool" is a **Pro** pitch, and the
heavy-lifting counterpart is **cloud agents** (`files/monetization-strategy.md` §4) — run the
expensive parallel/team work off the machine entirely.

---

## Work-list summary (ordered)

| # | Change | Type | Finding | Effort |
|---|---|---|---|---|
| 1 | Terminal scrollback 10k→2k, screenReaderMode opt-in | RAM | P12 | S |
| 2 | Unmount non-visible terminal panes | RAM | P12 | M |
| 3 | `React.lazy` all tab views | RAM/startup | P11 | S |
| 4 | Gate all pollers on active tab + visibility | CPU | P13 | S |
| 5 | Cache `workspace_status`; scope `/fleet` | CPU | P9 | M |
| 6 | SQLite WAL + busy_timeout | speed | P5 | S |
| 7 | Fix O(N²) `/commits`; lazy message bodies | speed | P4/P6 | M |
| 8 | mtime cache for `discover()` | speed | P8 | S |
| 9 | Retention + `VACUUM` + unreachable-commit GC | disk | P16 | M |
| 10 | Clean worktrees on trash | disk | P16 | S |
| 11 | Asset-index cache; stop editor re-copy | disk | P14 | S |
| 12 | PyInstaller `--onedir`; `Menu.setApplicationMenu(null)`; self-host fonts | startup | — | S |
| 13 | **Resource monitor** (footprint + storage + reclaim) | feature | — | L |
| 14 | CI memory-budget guardrail | process | — | M |

Effort: S = small, M = medium, L = large. All internal items are safe, local, reversible; the
resource-monitor cleanup actions are explicit-and-confirmed.

---

## Verification

- Line references match the current tree: `TerminalPane.tsx:175-176`, `PaneCanvas.tsx`
  (per-run panes), `Shell.tsx` (imports/always-mounted views), `viewmanager.ts:66`,
  `storage/sqlite.py:65`, `core/repo.py` (`trash_session`), `library.ts:filePath`,
  `main.ts:509-548`.
- Every claim maps to a finding in `files/codebase-audit.md` §C.
- Resource-monitor spec reuses the standard tab wiring and the preload bridge; no
  auto-deletion without an explicit, confirmed action.
- This task added **only this doc** — no app-code changes.
