# All-in-one workbench — Round 5: embedding third-party clients

> Status: **DbGate shipped (committed `e96c126`). Restfox + browser chrome written
> and verified but NOT committed.** Companion: `files/editor-integration.md`
> (round 3, the code-server sidecar this pattern was extracted from),
> `files/browser-embedding.md` (round 4, the in-app browser).
> For the actionable "pick this up" list see `files/session-handoff.md`.

## The decision

Do not build API/DB clients from scratch. Embed existing, self-hostable web
clients **the same way the Editor tab embeds VS Code**: a sidecar process bound to
`127.0.0.1`, shown in a sandboxed `WebContentsView` from the shared `ViewManager`.

Postman itself **cannot** be embedded — closed source, no self-hostable server,
the web app is cloud/account-bound. The embeddable Postman-alikes:

| Tool | License | Embeddable? |
|---|---|---|
| **Restfox** | MIT | ✅ ships a `web-standalone` express server on a configurable `PORT`, no DB |
| Hoppscotch | MIT | ⚠️ self-host = Postgres + NestJS backend + admin (3 services, Docker) |
| Bruno | MIT | ❌ desktop/CLI only, no web server |
| Yaade | MIT | ⚠️ self-hosted, Node + SQLite, smaller |

For databases, one sidecar covers everything:

| Tool | License | Engines |
|---|---|---|
| **DbGate Community** | **GPL-3.0** | MySQL, Postgres, SQL Server, Oracle, MongoDB, Redis, SQLite, ClickHouse, MariaDB, CockroachDB (Redshift/Cosmos are Premium) |
| CloudBeaver | Apache-2.0 | same breadth, but a JVM (+JRE ~300 MB) |

## The three sidecars

All three use one shape: resolve entry → pick a free loopback port → spawn →
health-gate → hand the renderer a URL → `ViewManager` hosts it in its own
`persist:*` partition. Each has a guarded, idempotent fetch script.

| | Editor | DB | API |
|---|---|---|---|
| Manager | `electron/editor.ts` | `electron/dbgate.ts` | `electron/restfox.ts` |
| Fetch | `scripts/fetch-editor.mjs` | `scripts/fetch-dbgate.mjs` | `scripts/fetch-restfox.mjs` |
| npm | `fetch:editor` | `fetch:dbgate` | `fetch:restfox` |
| Panel | `views/EditorView.tsx` | `shell/db/DbGatePanel.tsx` | `shell/api/RestfoxPanel.tsx` |
| View id | `editor` | `dbgate` | `restfox` |
| Runtime | ships its own Node | Electron's Node (`ELECTRON_RUN_AS_NODE`) | Electron's Node (`ELECTRON_RUN_AS_NODE`) |

**Pin the versions.** `dbgate-serve@7.3.x` is broken on npm
(`dbgate-plugin-mysql@7.3.x` requires `dbgate-mysql-dumper@7.3.x`, never
published — only 0.1.x exists), so we pin **7.2.6**. Restfox's `main` now
declares `engines.node >= 26` while Electron ships Node 22, so we pin the tag
**v0.40.0** (no such constraint) — a future tag would force shipping a Node
runtime instead of `ELECTRON_RUN_AS_NODE`.

### Fetch gotchas found the hard way

- **`omit=dev` is set on this machine.** The Restfox UI build needs
  devDependencies (vite, rollup-plugin-copy) → the script passes `--include=dev`.
- **Restfox must be `git clone`d, not tarballed**: its UI build runs
  `git describe --tags` (`vite-plugin-revision`) and dies with "No names found"
  without a real repo.
- **Restfox's server cwd matters**: `express.static('public')` is relative, so the
  sidecar spawns with `cwd = path.dirname(entry)`.
- **DbGate writes `~/.dbgate`**; the sidecar sets `HOME` to its userData dir so it
  never touches the user's home. It also runs `SKIP_ALL_AUTH=1` (loopback +
  sandboxed view only, the same call the editor sidecar makes).
- **DbGate is GPL-3.0.** Spawning it as a separate process (mere aggregation) is
  the usual mitigation; check it against distribution plans.

## Browser chrome (round 4 follow-up)

The Browser tab was already real Chromium (`ViewManager`: "any http(s) page
loads"), so there was nothing to embed — the gap was *chrome*. Added:

- **Tabs** — `ViewManager` was already a pool keyed by view id, so a tab is just
  another view (`browser-1`, `browser-2`, …). Popups / `target=_blank` now emit a
  `{type:"open"}` event and become a **new tab** instead of replacing the page.
- **History** + **bookmarks** — persisted in `localStorage` via
  `src/shell/browser/library.ts` (`useSyncExternalStore`, shared by the view and
  the rail without threading state through `Shell`).
- **Find in page** — `webContents.findInPage`; counts arrive as `found` events.
- **Zoom** — `webContents.setZoomLevel`, persisted.

New `ViewManager` methods: `find`, `stopFind`, `setZoom`. New events on
`shared/browser.ts`: `open`, `found`. New IPC: `ctx:view-find`,
`ctx:view-find-stop`, `ctx:view-set-zoom`.

## Files

**Restfox (uncommitted)**
- `desktop/electron/restfox.ts`, `desktop/shared/restfox.ts`
- `desktop/scripts/fetch-restfox.mjs`
- `desktop/src/shell/api/RestfoxPanel.tsx`
- touched: `electron/main.ts`, `electron/preload.ts`, `src/bridge.d.ts`,
  `package.json` (`fetch:restfox` + `extraResources` `build/restfox → restfox`),
  `views/ApiView.tsx` (`Native | Restfox` toggle), `Shell.tsx`

**Browser chrome (uncommitted)**
- `desktop/src/shell/browser/library.ts`
- touched: `electron/viewmanager.ts`, `shared/browser.ts`, `electron/main.ts`,
  `electron/preload.ts`, `src/bridge.d.ts`, `src/shell.css`,
  `views/BrowserView.tsx`, `rail/BrowserRail.tsx`

**Shipped in `e96c126`** (for reference): Monaco body editor
(`api/CodeEditor.tsx`, `monacoSetup.ts`, `useShellTheme.ts`), cookie auth kind
(`apiclient/client.py`, `core/models.py`), `api/formBody.ts`, endpoints rail +
view, Why view, DbGate (`electron/dbgate.ts`, `db/DbGatePanel.tsx`).

## Acceptance

- Editor sidecar: code-server starts, VS Code renders on the project folder.
- DB sidecar: `npm run fetch:dbgate` installs; boots under `ELECTRON_RUN_AS_NODE`;
  logs `DbGate API listening on port <PORT>`; `GET /` → 200, `<title>DbGate</title>`.
- API sidecar: `npm run fetch:restfox` clones + builds + installs; boots; logs
  `Restfox running on port http://localhost:<PORT>`; `GET /` → 200,
  `<title>Restfox</title>`.
- Chosen view keeps its e2e selectors: native is the **default** in both the API
  tab (`HTTP method`, `Request URL`, `Send`) and the DB tab (`Engine`,
  `Connection name`, `Connect`, `SQL`, `Run`), and the browser keeps
  `.cg-browser`, `.cg-browser-tile`, `.cg-browser-status[data-status]`,
  `getByLabel("Address")`.

## Sources

- [Restfox](https://github.com/flawiddsouza/Restfox) · [web-standalone README](https://github.com/flawiddsouza/Restfox/blob/main/packages/serve/README.md)
- [DbGate docs](https://docs.dbgate.io/dbgate/) · [DbGate env variables](https://docs.dbgate.io/dbgate/customization/env-variables/index.html)
- [CloudBeaver supported databases](https://dbeaver.com/docs/cloudbeaver/Supported-databases/)
- [Hoppscotch self-host](https://docs.hoppscotch.io/guides/articles/self-host-hoppscotch-on-your-own-servers)
