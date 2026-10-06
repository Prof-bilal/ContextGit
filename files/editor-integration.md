# All-in-one workbench — Round 3: the code editor

> Research round 3 of 4. Companions: `all-in-one-landscape.md`,
> `workspace-architecture.md`, `browser-embedding.md`, `api-db-clients.md`.
> Status: proposal. Decision: **full VS Code sidecar**. Verified 2026-10-06.

## Options

| Option | What it is | Positives | Costs |
|---|---|---|---|
| **Monaco** | The editor engine inside VS Code (MIT) | Tiny, embeddable, full control, no sidecar | No extensions, no built-in explorer/SCM/terminal; language intelligence needs `monaco-languageclient` + a language server per language |
| **VS Code sidecar** — `code-server` / `openvscode-server` (both MIT) | Real VS Code served over HTTP, embedded in a `WebContentsView` | The real editor, extensions, built-in explorer/SCM/terminal; reaches the whole VS Code UI | Ships its own Node runtime (~150–250 MB); Open VSX only, not the Microsoft marketplace; a security surface to lock down |
| **Fork VSCodium** | Rebuild the app shell on a VSCodium fork | Maximal fidelity | Throws away the existing Electron workbench; a large fork to maintain; marketplace/extension licensing gaps (Microsoft is actively enforcing) |

**Decision: bundle `code-server` as a sidecar.** It is single-user, has built-in auth
(`--auth password`), and — the deciding factor — a reuse CLI (`code-server <path>`)
that opens a file or folder in the already-running instance. That gives the native
file explorer a clean way to drive the embedded editor. `openvscode-server` is a
legitimate alternative (upstream-faithful, `--connection-token` built for embedding);
the manager stays server-agnostic behind `vscode.ts` so the two can swap.

## Lifecycle

`desktop/electron/vscode.ts` mirrors the Python backend lifecycle already in
`main.ts` (spawn, health-gate, cache, kill on quit):

```
app ready
  └─ vscode.ensure()            # lazy: only when the Editor panel is opened
       ├─ resolveServer()       # packaged: resources/editor/; dev: desktop/build/editor/
       ├─ pickFreePort()        # random loopback port
       ├─ writeConfig()         # userData/code-server/config.yaml (hashed password)
       ├─ spawn code-server --bind-addr 127.0.0.1:<port> --config <cfg>
       └─ healthGate GET /healthz  → { baseUrl }
Editor panel opens
  └─ WebViewPanel → partition persist:vscode → baseUrl (one-time programmatic login)
File explorer double-click
  └─ vscode.openPath(abs)  →  code-server --reuse-window <abs>
app quit
  └─ vscode.stop()
```

- The server is started **once** and reused across editor panels and projects; opening a
  different project folder reuses the same instance (`code-server --reuse-window <dir>`).
- The editor is a **native-content panel** hosted by the shared `WebViewPanel`, so it
  obeys the same bounds-sync rules as the browser (`browser-embedding.md`).

## Security hardening

The exact published anti-pattern to avoid: `code-server` with `--auth none`, bound to
all interfaces, inside an Electron window with `nodeIntegration: true` — that combination
was reported to CISA as remote code execution. Our configuration:

- Bind **`127.0.0.1` only**, on a random high port.
- **Auth on** (`--auth password`), password generated per install and stored hashed in
  a `config.yaml` under `app.getPath("userData")` — never in the project repo.
- Embed in a **dedicated session partition** (`persist:vscode`), so its cookies and
  storage are isolated from the app and the browser panel.
- The hosting view uses `sandbox: true`, `contextIsolation: true`, no `nodeIntegration`,
  no preload.
- Optional second lock: the manager can reject non-loopback requests at the health-gate
  and only ever hands the renderer a loopback URL.

## Native explorer → editor handshake

The native file explorer (`files/workspace-architecture.md`, F3) opens files by running
the bundled `code-server --reuse-window <abs path>`; the running instance focuses that
file in the embedded editor. This is why `code-server` is preferred over
`openvscode-server` (the latter has no equivalent reuse CLI and would need a URL/URI
protocol we have not verified). Fallback if the handshake proves flaky: VS Code's own
explorer is available inside the editor panel, so the native tree is a convenience, not
a hard dependency.

IPv4-style `file://` URI (`vscode://file/<path>`) is **not** assumed — it is a spike item
for F4, with the reuse CLI as the primary path.

## Packaging

- `desktop/scripts/fetch-vscode-server.mjs` downloads a **pinned** `code-server` release
  for the target OS/arch into `desktop/build/editor/`.
- `desktop/package.json` `extraResources` ships `build/editor/` → `resources/editor/`.
- Installer grows by roughly 150–250 MB (it carries its own Node runtime). It is an
  extraResource, not a renderer dependency, so the app still runs if it is absent — the
  Editor panel then shows a "start / install the editor" affordance instead of failing.
- Extensions come from **Open VSX**, not the Microsoft marketplace — proprietary
  extensions (Copilot, Microsoft C/C++) are unavailable. Documented as a known limit.

## Files

**New**
- `desktop/electron/vscode.ts` — sidecar manager (`ensure`, `openPath`, `stop`, `status`)
- `desktop/scripts/fetch-vscode-server.mjs` — pinned fetch into `build/editor/`
- `desktop/src/shell/editor/EditorPanel.tsx` — the panel (uses `WebViewPanel`)
- `desktop/src/shell/editor/useEditor.ts` — status + actions

**Modified**
- `desktop/electron/main.ts` — start/stop the sidecar; `ctx:vscode-*` IPC
- `desktop/electron/preload.ts` + `desktop/src/bridge.d.ts` — bridge methods
- `desktop/package.json` — `extraResources` + fetch script
- `README.md`, `files/README.md` — feature + doc index

## Acceptance (F4)

- Opening the Editor panel starts the sidecar and renders the VS Code workbench on the
  active project folder.
- Double-clicking a file in the native explorer focuses that file in the editor.
- The sidecar listens on `127.0.0.1` only, requires auth, and is not reachable from
  another host.
- `npm run dist` bundles the sidecar; the app still starts (degraded) if it is missing.

## Open question

Sidecar choice — ship `code-server` (recommended, reuse CLI + auth) vs
`openvscode-server` (upstream-faithful, `--connection-token`). Kept server-agnostic.

## Sources

- [code-server](https://github.com/coder/code-server) · [code-server vs OpenVSCode vs Coder](https://www.bigiron.cc/guides/code-server-vs-openvscode-vs-coder-browser-based-dev)
- [openvscode-server](https://github.com/gitpod-io/openvscode-server) · [connection token](https://github.com/gitpod-io/openvscode-server/discussions/249)
- [VSCodium](https://github.com/VSCodium/vscodium) · [4 open-source VS Code forks](https://www.howtogeek.com/open-source-vs-code-forks-do-what-microsoft-wont/)
- [CISA bulletin — code-server exposed with auth disabled (May 2026)](https://www.cisa.gov/news-events/bulletins/sb26-131)
- [Monaco vs CodeMirror vs Ace in 2026](https://www.pistack.xyz/posts/2026-08-22-browser-code-editors-monaco-codemirror-ace-comparison/) · [monaco-languageclient](https://github.com/TypeFox/monaco-languageclient)
- [Open VSX Registry](https://open-vsx.org/)
