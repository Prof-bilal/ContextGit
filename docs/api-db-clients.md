# All-in-one workbench — supporting clients: HTTP and database

> Companion to `all-in-one-landscape.md`, `workspace-architecture.md`,
> `editor-integration.md`, `browser-embedding.md`.
> Status: **API client built** (Phase 5, 2026-10-07); **DB client: proposal**.
> Scope: the **API client** and **DB client** panels.

These are the two "everyday" tools a builder opens next to the editor — an HTTP client
(Postman/Bruno) and a database client (DBeaver/Beekeeper). Both are pure backend +
DOM panels: no native view, no extra process. Business logic lives in new Python
packages reached through thin FastAPI routes.

## HTTP / API client — built

A new top-nav tab, **API**, between Editor and Agent. Same frozen layout as every other
tab: rail on the left, one view, response details in the dock.

**Backend** — `contextgit/apiclient/`:

- `client.py` executes a request with `httpx` (already a core dependency): method, URL,
  query, headers, body (`json` | `text` | `form`), auth helpers (bearer / basic / api-key),
  timeout, TLS-verify toggle, redirect policy. Returns status, reason, headers, body
  (capped at 512 KB), elapsed ms and size. Bad URLs, connection failures and malformed
  JSON bodies all raise `HttpRequestError`, so the API answers with one readable error.
- `store.py` — collections.
- Models live in `contextgit/core/models.py` (`HttpRequestSpec`, `HttpResponseResult`,
  `HttpCollection`, `HttpSavedRequest`, `HttpHistoryEntry`) because they cross the
  API boundary.

**Collections are files, not rows.** A collection is `<repo>/api/<collection>.json` —
Bruno-style, git-versionable, and consistent with ContextGit's "context belongs in the
repo" idea. Names are validated (`[A-Za-z0-9][A-Za-z0-9._ -]{0,63}`) so a name can never
escape the directory. Request **history** is run data and lives in SQLite
(`0015_http_history.sql`).

Routes (in `contextgit/api/app.py`):

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/http/request` | execute a request, return the full response, record it |
| GET | `/api/v1/http/collections` | list the repo's collections |
| GET | `/api/v1/http/collections/{name}` | read one collection |
| PUT | `/api/v1/http/collections/{name}` | create/save a collection |
| DELETE | `/api/v1/http/collections/{name}` | delete a collection |
| GET | `/api/v1/http/history` | recent requests, newest first (capped) |

**Panel** — `desktop/src/shell/views/ApiView.tsx`, `rail/ApiRail.tsx`,
`api/useApiClient.ts`, `api/KeyValueEditor.tsx`, typed client methods in `lib/api.ts`:
method + URL bar with Send, Params/Headers/Body/Auth panes, a formatted response viewer
(pretty JSON, headers, status, timing, size), saved collections in the rail, and the
request history below them (clicking one loads it back into the editor). Covered by
`tests/test_http_client.py` and the desktop e2e "API tab sends a real request".

## Database client — built

A new **Database** tab. Same frozen pattern: connection form and schema tree on the left,
query editor and results grid in the middle, connection details in the dock.

**Backend** — `contextgit/dbclient/`:

- `adapters.py` — one interface over **SQLite** (stdlib, always available), **Postgres**
  (`psycopg[binary]`) and **SQL Server** (`pymssql`), all installed by the `db` extra.
  Drivers are imported lazily: a missing one becomes *"run `pip install \"contextgit[db]\"`"*,
  never a crashed app. `GET /api/v1/db/drivers` reports what this install can use.
- **Writes are refused before they reach the server** when a connection is read-only (the
  default), and every result is capped (500 rows by default, 5000 hard) with the true row
  count and a `truncated` flag.
- `store.py` — connection specs are **files** in `<repo>/db/`; live handles live in an
  in-memory registry keyed by id.
- **Passwords are never persisted.** They arrive with the request that opens the
  connection and die with it; a saved connection is engine/host/database/user/read-only
  and nothing else.
- Handles are serialised by a lock held in a template method
  (`tables`/`query`/`close` → `_tables`/`_query`/`_close`) because FastAPI serves requests
  on different threadpool threads.

Routes: `GET /api/v1/db/drivers`, `GET|PUT|DELETE /api/v1/db/connections[/{name}]`,
`POST /api/v1/db/open`, `DELETE /api/v1/db/open/{id}`, `GET /api/v1/db/schema`,
`POST /api/v1/db/query`.

**Panel** — `desktop/src/shell/views/DbView.tsx`, `rail/DbRail.tsx`, `db/useDatabase.ts`,
typed clients in `lib/api.ts`. Covered by `tests/test_dbclient.py` (12) and the desktop
e2e "the DB tab connects to SQLite and runs a query".
