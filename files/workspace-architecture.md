# All-in-one workbench — Round 2: architecture

> Research round 2 of 4. Companion: `all-in-one-landscape.md` (round 1),
> `editor-integration.md` (round 3), `browser-embedding.md` (round 4),
> `api-db-clients.md` (supporting clients). Status: proposal. Verified 2026-10-06.

## Principles (inherited from the repo)

- Core library owns all logic; API routes and React components stay thin.
- Local-first, single user, SQLite, numbered migrations, deterministic commits.
- Renderer talks HTTP/SSE to FastAPI only — no direct storage/LLM/native access.
- Reuse existing seams: `Repo`, sessions/staging, `gitops/`, the merge engine,
  `Shell.tsx`'s view components, the `window.contextgit` preload bridge.
- Keep live surfaces (terminals, editor, browser) mounted across layout changes.

## Process view

```
┌──────────────────────────── Electron (renderer + main) ────────────────────────────┐
│ Renderer: dockview WorkbenchCanvas                                                 │
│   panels: chat · code · git · usage · editor · files · browser · api · db          │
│   (each panel is a self-contained surface: its own rail/view/dock internally)      │
└───────────────▲───────────────────────────────────────────────▲────────────────────┘
                │ REST /api/v1 + SSE                            │ IPC (ctx:*)
┌───────────────┴───────────────┐                ┌──────────────┴─────────────────────┐
│ FastAPI (thin)                │                │ Electron main                      │
│   core/  (Repo, sessions)     │                │   backend spawn (exists)           │
│   apiclient/  (new)  HTTP     │                │   pty.ts (exists)                  │
│   db/         (new)  adapters │                │   viewmanager.ts  (new) WebContents│
│   llm/ merge/ gitops/ (exists)│                │   fsapi.ts        (new) fs+chokidar │
│   storage/sqlite.py (0013)    │                │   vscode.ts       (new) code-server │
└───────────────────────────────┘                │   secrets.ts      (new) safeStorage │
                                                 └────────────────────────────────────┘
```

Two kinds of panel:
- **DOM panels** — React components rendered inside dockview (chat, code, git, usage,
  files, api, db).
- **Native-content panels** — a thin React shell hosting a `WebContentsView` owned by
  the main process (editor, browser); see `browser-embedding.md`.

## Keep the existing shell — add tabs, not a layout rewrite

**Decision (corrected): the UI and layout stay exactly as they are.** No dockview, no
pane canvas, no layout persistence, no new header menu. The existing `TopNav` segmented
tabs, the `rail | main | dock` grid and the per-tab `bottomBar` are untouched. Each new
surface (Files, Editor, Browser, API, DB) is added as **one more tab**, following the
exact pattern the five current tabs already use.

### Adding a tab (the existing contract)

`TabId` in `desktop/src/shell/TopNav.tsx` is the only cross-file type; `Shell.tsx` holds
the tab state and dispatches each tab through four switches. A new surface is four
mechanical edits in `Shell.tsx` plus one view component:

1. `TopNav.tsx` — extend `TabId`.
2. `Shell.tsx` — add the id to `TAB_IDS` (deep-link validation) and to the `tabs[]` list.
3. `Shell.tsx` — add a `case` to `rail()`, `view()` and `dock()` (and `bottomBar()` only
   if the surface needs one).
4. `desktop/src/shell/views/<Name>View.tsx` (+ a `rail/<Name>Rail.tsx` and a polling hook
   `shell/<area>/use<Name>.ts` when needed).

Live surfaces follow the Code-tab pattern: rendered in an always-mounted
`<div className="cg-view" data-active={tab === id}>` so terminals, an editor or a browser
view survive tab switches. No CSS churn — reuse `.cg-view`, `.cg-view-toolbar`,
`.cg-view-body`, `.cg-rail`, `.cg-dock` and the `primitives.tsx` controls.

### The only new primitive

Native-content panels (the in-app browser and the embedded editor) can't be a DOM
element — they are main-process `WebContentsView`s. They are wrapped in one shared React
component, `desktop/src/shell/views/WebViewPanel.tsx`, that measures its DIV and syncs
bounds over IPC. That is the single new layout primitive; everything else reuses the
existing shell verbatim.

## Renderer data + bridge

- **HTTP**: add typed methods to the `api` object in `lib/api.ts` for the new backend
  routes (HTTP client, DB client). Polling/SSE patterns are unchanged.
- **IPC**: new channels in `desktop/electron/main.ts`, mirrored in `preload.ts` and
  typed in `desktop/src/bridge.d.ts`:
  - `ctx:fs-*` (listdir/read/write/stat/create/rename/delete/reveal/watch/unwatch)
  - `ctx:view-*` (create/destroy/set-bounds/set-visible/load/back/forward/reload/devtools)
  - `ctx:vscode-*` (status/start/open-path) and the `view:*` events push
  - `ctx:secrets-*` (encrypt/decrypt via `safeStorage`)

## Security posture

- Embedded content is sandboxed (`sandbox`, `contextIsolation`, no `nodeIntegration`,
  no preload) in a dedicated session partition; navigation is allowlisted; window-open
  is denied. See `browser-embedding.md`.
- The editor sidecar binds loopback only with auth, in its own partition. See
  `editor-integration.md`.
- The fs service validates every path against known project roots/worktrees (reuse the
  `resolvePtyCwd` guard in `main.ts`).
- DB passwords are encrypted with `safeStorage`; never written to the repo or plaintext
  SQLite. See `api-db-clients.md`.

## Phased rollout

| Phase | Deliverable |
|---|---|
| F1 | dockview canvas; surfaces extracted; layout persistence + presets |
| F2 | view manager + Browser panel (`browser-embedding.md`) |
| F3 | fs service + File explorer panel |
| F4 | code-server sidecar + Editor panel (`editor-integration.md`) |
| F5 | HTTP client panel (`api-db-clients.md`) |
| F6 | DB client panel (`api-db-clients.md`) |
| F7 | polish: floating panels, ⌘K palette, global search, settings |

Each phase keeps the repo's verification standard green: `cd desktop && npm run build`,
root `npx tsc --noEmit`, `.venv/bin/pytest -q`, and the Playwright e2e suite.

## Risks

- **Dockview refactor regresses existing tabs** — F1 keeps behavior identical and is
  gated by e2e before new panels are added.
- **WebContentsView bounds sync** — one `ResizeObserver` → IPC path; hide the native
  view when its panel is not visible; test with split panes.
- **Bundle size** (editor sidecar) — ship as an optional extraResource, lazy-start.
- **Scope creep toward Docker/marketing** — the deferred list is explicit; new surfaces
  must reuse the same panel primitive.

## Sources

- [dockview](https://dockview.dev/) · [dockview on GitHub](https://github.com/dockview/dockview)
- [Electron WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)
- [WebContentsView in Electron 30: multi-view apps](https://chenguangliang.com/en/posts/blog180_electron-webcontentsview/)
- [Electron security guide 2026](https://www.oflight.co.jp/en/columns/electron-security-guide-2026)
