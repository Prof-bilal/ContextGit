# All-in-one workbench — Round 1: landscape and positioning

> Research round 1 of 4 for the "one window" effort. Companions:
> `workspace-architecture.md` (round 2), `editor-integration.md` (round 3),
> `browser-embedding.md` (round 4), `api-db-clients.md` (supporting clients).
> Status: researched, direction approved. Verified 2026-10-06.

## The problem

A working developer in 2026 touches a dozen applications a day: a code editor, two
or three terminals, Postman for APIs, DBeaver/pgAdmin for databases, a browser with
DevTools, Docker Desktop — and now several AI coding agents in their own terminals.
Every alt-tab costs a few seconds of focus; over a day that compounds into 30–60
minutes lost to navigation rather than work.

ContextGit already owns the hardest part of this workflow: the terminal board, the
per-run git worktree, and — the actual moat — versioned, branchable, mergeable
context. The missing piece is the *rest* of the toolbox in the same window.

## The category already exists

"Put the whole dev toolbox in one native window" is a proven 2026 category, not a
bet. The reference product is **1DevTool** ($29 one-time): multi-agent terminals, an
HTTP client, a database client over 13 engines, an embedded browser with DevTools,
Docker management, a design canvas and developer utilities — all in a single
window. ContextGit should not pretend it is inventing this; it should enter the
category and bring its differentiator.

| Tool | Shape | Versions code | Versions context | Ships the toolbox |
|---|---|---|---|---|
| **VS Code** | Editor-first; everything else via extensions | ✓ | ✗ | ⚠ bolted-on, conflicting keybindings |
| **JetBrains** | Deep per-language IDE | ✓ | ✗ | ⚠ heavy, weak multi-agent |
| **Cursor** | VS Code fork, inline AI | ✓ | ✗ | ✗ editor only, $20/mo |
| **Zed** | Fast editor + collab | ✓ | ✗ | ✗ editor only |
| **BridgeMind** | Agent super-app, split/snap/dock panes, docked browser | ✓ worktrees | ✗ (one-shot handoff) | ⚠ partial |
| **1DevTool** | Full toolbox in one window | ✓ | ✗ | ✓ (no context layer) |
| **Conductor / Vibe Kanban / Superset** | Parallel agents in worktrees | ✓ | ✗ | ✗ |
| **ContextGit (this)** | Memory layer + agent board | ✓ | **✓** | ← this effort adds the toolbox |

**The gap is unchanged from `files/plan.md`:** everyone versions *code*
(worktrees, diffs, merges) and nobody versions the *context*. 1DevTool has the
toolbox but no memory; BridgeMind has the panes but a lossy one-shot handoff;
ContextGit has the memory but not yet the toolbox. Filling the toolbox turns the
memory layer from a feature into the floor of the workspace.

**Positioning line:**
> The one window where you build — editor, browser, files, API and database clients,
> and your agents — sitting on top of version-controlled, mergeable context no other
> tool has.

## Surface catalog

Everything worth having in one window, with its open-source basis and where it lands.
Priority reflects the approved scope: **dev core + API/DB clients first**.

| Surface | Basis | Priority |
|---|---|---|
| Terminal board | existing (`node-pty` + xterm.js) | shipped |
| Git / history / merge | existing (DAG, React Flow, lanes) | shipped |
| Chat / research / docs | existing (provider adapters, DAG) | shipped |
| Code editor (full VS Code) | `code-server` sidecar (MIT) | **P1** |
| In-app browser + DevTools | Electron `WebContentsView` | **P1** |
| File explorer | custom tree + `chokidar` | **P1** |
| HTTP / API client | `httpx`; Bruno-style file collections | **P1** |
| Database client | SQLite (stdlib), `psycopg`, `PyMySQL`, `redis` | **P1** |
| Command palette | in-app (⌘K) | P2 |
| Global search | ripgrep-style over the project | P2 |
| Release / CI view | GitHub API, Actions | later |
| Docker management | Docker Engine API | later |
| Analytics dashboard | Umami / Plausible (self-hosted) | later |
| SEO / site audit | Lighthouse (Playwright already a dep) | later |
| Social scheduling | Postiz (self-hosted) | later |
| Email / campaigns | Listmonk | later |
| Utilities | JSON / regex / base64 / hash / diff (diff engine exists) | later |
| Design canvas | tldraw / Excalidraw | later |

The marketing column is deliberately parked: it is real demand but it is not the
foundation, and building it before the dev core would be a toolbox with no bench.

## Decisions taken

| Fork | Decision |
|---|---|
| Code editor | Full VS Code **sidecar** embedded (not Monaco, not a VSCodium fork) |
| First surfaces | **Dev core + API/DB clients** |
| Layout | **Dockable pane canvas now** (dockview) |
| In-app browser | **Preview + DevTools, allowlisted** |

## Out of scope (for this effort)

Multi-user / cloud sync; a general-purpose browser for any URL; forking VS Code;
the marketing suite (deferred to a later phase); replacing the existing git/history
surfaces (they are reused as panels).

## Sources

- [The Best All-in-One Developer Tools in 2026: Why Desktop Beats Cloud](https://stoicsoft.github.io/1devtool/2026/03/25/best-all-in-one-developer-tools-2026.html)
- [1DevTool](https://1devtool.com)
- [BridgeMind](https://www.bridgemind.ai/)
- [Conductor](https://www.conductor.build/) · [Vibe Kanban](https://github.com/BloopAI/vibe-kanban) · [Superset](https://superset.sh/)
- [Electron Web Embeds](https://www.electronjs.org/docs/latest/tutorial/web-embeds/)
- [code-server](https://github.com/coder/code-server) · [openvscode-server](https://github.com/gitpod-io/openvscode-server) · [VSCodium](https://github.com/VSCodium/vscodium)
- [Best Free Open Source Database GUI Tools](https://www.bytebase.com/blog/top-open-source-sql-clients/)
- [Postiz](https://github.com/gitroomhq/postiz-app) · [Listmonk](https://listmonk.app/) · [Umami](https://umami.is/)
