# All-in-one workbench — supporting clients: HTTP and database

> Companion to `all-in-one-landscape.md`, `workspace-architecture.md`,
> `editor-integration.md`, `browser-embedding.md`. Status: proposal.
> Scope: the **API client** and **DB client** panels. Verified 2026-10-06.

These are the two "everyday" tools a builder opens next to the editor — an HTTP client
(Postman/Bruno) and a database client (DBeaver/Beekeeper). Both are pure backend +
DOM panels: no native view, no extra process. Business logic lives in new Python
packages reached through thin FastAPI routes.

## HTTP / API client

**Backend** — `contextgit/apiclient/`:

- `client.py` executes a request with `httpx` (already a core dependency): method, URL,
  query, headers, body (`json` | `form` | `raw`), auth helpers (bearer / basic / api-key),
  timeout, TLS-verify toggle, redirect policy. Returns status, headers, body, elapsed ms
  and size.
- `models.py` — Pydantic request/response models.
- `store.py` — collections.

**Collections are files, not rows.** A collection is
`.contextgit/api/<collection>.json` in the project — Bruno-style, git-versionable, and
consistent with ContextGit's "context belongs in the repo" idea. Request **history** is
ephemeral run data and lives in SQLite.

Routes (in `contextgit/api/app.py`, schemas in `contextgit/api/schemas.py`):

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/http/request` | execute a request, return the full response |
| GET | `/api/v1/http/collections` | list collections for the active project |
| GET | `/api/v1/http/collections/{name}` | read one collection |
| PUT | `/api/v1/http/collections/{name}` | create/save a collection |
| DELETE | `/api/v1/http/collections/{name}` | delete a collection |
| GET | `/api/v1/http/history` | recent requests (capped) |

**Panel** (`shell/api/ApiPanel.tsx` + `useApiClient.ts`): collection tree, request editor
(method/URL/params/headers/body/auth tabs), a formatted response viewer (pretty JSON,
headers, timing, size), and history. "Save to collection" writes the file through the
backend.

## Database client

**Backend** — `contextgit/db/`:

- Adapters behind one interface: **SQLite** (stdlib, always available), **PostgreSQL**
  (`psycopg[binary]`), **MySQL** (`PyMySQL`), **Redis** (`redis`). New optional extras in
  `pyproject.toml` (`db = [...]`) so the base install stays lean.
- `registry.py` holds live connections keyed by a connection id; `connect`, `schema`
  (tables/columns), `query` (SQL for SQL engines; commands for Redis), `close`.
- Results are capped and paged; a **read-only** toggle is available per connection.

Routes:

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/db/connect` | open a connection, return an id + server version |
| DELETE | `/api/v1/db/connections/{id}` | close a connection |
| GET | `/api/v1/db/schema` | tables / columns / keys for a connection |
| POST | `/api/v1/db/query` | run a query, return columns + rows (paged, capped) |
| GET | `/api/v1/db/rows` | page through the last result |

**Secrets.** Passwords are **never** written to the backend in plaintext. The renderer
sends a password to the **main process**, which encrypts it with Electron `safeStorage`
(`secrets.ts`) and stores the ciphertext in the desktop's userData store; only non-secret
connection metadata (engine, host, port, user, database) is passed to the backend. The
plaintext exists only in memory for the duration of a `connect` call.

**Panel** (`shell/db/DbPanel.tsx` + `useDbClient.ts`): connection list, schema tree, a SQL
editor, a results grid with paging, and a read-only indicator.

## Data model

Migration `contextgit/storage/migrations/0013_workspace_tools.sql`:

```sql
http_history(id, project_path, method, url, status, elapsed_ms, size, created_at)
db_connections(id, project_path, engine, host, port, username, database, created_at)
```

`db_connections` holds **metadata only** — no secret column. New accessor methods go in
`contextgit/storage/sqlite.py`; new models in `contextgit/core/models.py`.

## Security

- **Secrets**: DB passwords encrypted via `safeStorage` in the main process; never in the
  repo, never plaintext in SQLite.
- **Request history**: redact obvious secrets (authorization headers, api-key params)
  before storing.
- **Layers unchanged**: the renderer talks to FastAPI over HTTP only; `httpx` and the DB
  drivers are called from the backend, behind the same exception handler and localhost
  bind as every other route.
- **No arbitrary local file access** from these panels beyond the existing project-root
  guarantees.

## Files

**New (backend)**
- `contextgit/apiclient/{__init__,client,models,store}.py`
- `contextgit/db/{__init__,registry,adapters,models}.py`
- `contextgit/storage/migrations/0013_workspace_tools.sql`
- `tests/test_http_client.py`, `tests/test_db_client.py` (SQLite adapter is hermetic;
  Postgres/MySQL behind a skip-if-unavailable marker)

**New (desktop)**
- `desktop/src/shell/views/ApiView.tsx`, `shell/api/{ApiPanel.tsx,useApiClient.ts}`
- `desktop/src/shell/views/DbView.tsx`, `shell/db/{DbPanel.tsx,useDbClient.ts}`

**Modified**
- `contextgit/api/app.py`, `contextgit/api/schemas.py`, `contextgit/storage/sqlite.py`,
  `contextgit/core/models.py`, `pyproject.toml` (`db` extra)
- `lib/api.ts` (typed methods), `desktop/electron/{main,preload}.ts`,
  `desktop/src/bridge.d.ts` (`ctx:secrets-*`), `README.md`, `files/README.md`

## Acceptance (F5, F6)

- **F5**: send a request, see status/headers/body/timing; save a collection under
  `.contextgit/api/` and reload it.
- **F6**: connect to SQLite and Postgres, browse the schema, run a query, page results;
  the stored password is ciphertext on disk (verified by inspecting the store).

## Open questions

- DB engine order — SQLite (hermetic, testable) → Postgres → MySQL/Redis (recommended).
- Collections format — JSON files under `.contextgit/api/` (recommended) vs YAML.

## Sources

- [httpx](https://www.python-httpx.org/) · [psycopg 3](https://www.psycopg.org/psycopg3/) · [PyMySQL](https://github.com/PyMySQL/PyMySQL) · [redis-py](https://github.com/redis/redis-py)
- [Bruno — offline, git-friendly API client](https://www.usebruno.com/)
- [Best Open Source Database Tools in 2026](https://opensourceprojects.cc/blog/best-open-source-database-tools)
- [Electron `safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage)
