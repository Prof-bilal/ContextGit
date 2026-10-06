# All-in-one workbench — Round 4: the in-app browser

> Research round 4 of 4. Companions: `all-in-one-landscape.md`,
> `workspace-architecture.md`, `editor-integration.md`, `api-db-clients.md`.
> Status: proposal. Decision: **`WebContentsView`, preview + DevTools, allowlisted**.
> Verified 2026-10-06.

## Embedding options in Electron 39

Electron offers three ways to show third-party web content:

| Option | Model | Control | Official guidance |
|---|---|---|---|
| `<iframe>` | In the renderer's DOM/process | Lowest; subject to the site's CSP and `X-Frame-Options` | Fine for friendly content |
| `<webview>` | Out-of-process iframe, custom element | High, but async and unstable | **"We do not recommend you to use WebViews… consider switching to alternatives, like `iframe` and `WebContentsView`."** |
| `WebContentsView` | Main-process-owned, layered over the DOM | Highest — a full `webContents` per view | Recommended for an independent page inside a desktop shell |

**Decision: `WebContentsView`.** It is the officially recommended path, gives us a real
`webContents` (navigation events, DevTools, session partitions), and the same primitive
serves both the Browser panel **and** the embedded VS Code editor
(`editor-integration.md`).

The one cost: a `WebContentsView` is **not a DOM element** — the main process positions
it, so the renderer must tell it where the panel is on screen.

## Bounds-sync pattern

```
Renderer (WebViewPanel.tsx)                    Main (viewmanager.ts)
  ── view:create {id, partition, allowlist} ──▶  new WebContentsView(...)
  ── view:set-bounds {id, x,y,w,h} ──────────▶   view.setBounds(...)
     (ResizeObserver + scroll/resize listeners)  (no-op when unchanged)
  ◀─ view:did-navigate / page-title / loading ── (webContents events)
  ── view:destroy {id} ──────────────────────▶   view.webContents.close()
```

- The panel measures its placeholder `<div>` with a `ResizeObserver` and sends
  `view:set-bounds` on every change (debounced); the main process clamps to the window.
- When the panel is hidden (tab/group switch, floating panel), the renderer sends
  `view:set-visible false` so the native view does not float over other content.
- DevTools open **detached** (`openDevTools({ mode: "detach" })`) so they never overlap
  the view's bounds inside the canvas.
- This is the standard "measure and sync" approach for `WebContentsView`-based
  multi-view apps (see sources).

## View manager API

`desktop/electron/viewmanager.ts` — a small pool keyed by view id:

- `create({ id, partition, allowlist })`, `destroy(id)`, `destroyAll()`
- `setBounds(id, rect)`, `setVisible(id, visible)`
- `load(id, url)`, `back(id)`, `forward(id)`, `reload(id)`, `openDevTools(id)`
- events pushed to the renderer: `view:did-navigate`, `view:did-start-loading`,
  `view:did-stop-loading`, `view:page-title-updated`, `view:did-fail-load`,
  `view:devtools-closed`

## Security

Web content inside the app is the largest attack surface, so it is locked down:

- `webPreferences`: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`,
  **no preload** — the embedded page gets zero app privileges.
- **Dedicated session partition** (`persist:browser`) so cookies/storage are isolated
  from the app and from the editor partition.
- `setWindowOpenHandler` → **deny** new windows (optionally open an external URL in the
  OS browser via `shell.openExternal`).
- `will-navigate` guarded by an **allowlist** of origins: localhost/127.0.0.1 dev
  servers on any port (the per-run `PORT` already exists), plus a configurable list of
  documentation origins. Anything else is blocked or handed to the OS browser.
- No file:// navigation of local paths (that would route around the fs service's
  project-root guard).
- DevTools only from the app's own toolbar, never from page script.

## Panel UX

- URL bar with back / forward / reload, a security chip (allowed / blocked origin name),
  a DevTools toggle, and an "open in system browser" action.
- Start page lists the **active project's dev server** (from the run's `PORT`) and the
  pinned docs origins, so the common case is one click.
- A "this origin is blocked" state explains why, with an "allow for this session" button
  that adds it to the in-memory allowlist (never persisted silently).

## Files

**New**
- `desktop/electron/viewmanager.ts` — the `WebContentsView` pool
- `desktop/src/shell/canvas/WebViewPanel.tsx` — shared React shell (used by browser + editor)
- `desktop/src/shell/browser/BrowserPanel.tsx`, `shell/browser/useBrowser.ts`
- `desktop/shared/panels.ts` — shared panel id/type constants (with main)

**Modified**
- `desktop/electron/main.ts` — instantiate the view manager; register `ctx:view-*` IPC
- `desktop/electron/preload.ts` + `desktop/src/bridge.d.ts` — bridge methods + events
- `desktop/src/shell.css` — toolbar + placeholder styling (tokens only)

## Acceptance (F2)

- A localhost dev server renders inside the Browser panel; back/forward/reload work.
- DevTools open detached and do not overlap the panel.
- Navigating to a non-allowlisted origin is blocked with an explanatory state; the
  embedded page has no access to Node, IPC, or app storage.
- The view hides correctly when the panel is not visible and re-shows on focus.

## Sources

- [Electron Web Embeds](https://www.electronjs.org/docs/latest/tutorial/web-embeds/)
- [`<webview>` tag — "not recommended"](https://www.electronjs.org/docs/latest/api/webview-tag)
- [`WebContentsView` API](https://www.electronjs.org/docs/latest/api/web-contents-view)
- [WebContentsView in Electron 30: building multi-view apps](https://chenguangliang.com/en/posts/blog180_electron-webcontentsview/)
- [Complete Electron Security Guide 2026](https://www.oflight.co.jp/en/columns/electron-security-guide-2026)
