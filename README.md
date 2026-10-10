# ContextGit

**Version control for LLM conversations.** Branch, diff, merge and roll back
context the way you already do with code — then run several AI agents on the same
project without them colliding.

ContextGit pairs a **conversation DAG** (content-addressed, immutable commits of
messages) with a **git worktree per agent run**, so parallel agents work in
isolated checkouts and their reasoning merges together with their diffs.

> Status: `0.1.0-beta.2` beta. Interfaces and schema may change.

## Full workbench archive

The complete pre-five-tab workbench is preserved in the private
[`ContextGit-legacy-features`](https://github.com/Prof-bilal/ContextGit-legacy-features)
repository. It is anchored to commit `f8a9b68cf58ec90b5e970839811fa70bdef00821`
and the immutable tag
[`archive/full-workbench-before-five-tabs`](https://github.com/Prof-bilal/ContextGit-legacy-features/tree/archive/full-workbench-before-five-tabs).
The same archive tag is also present in this repository. Future UI reduction work
can remove archived surfaces from the main app without losing the original
implementation.

## Why

A chat thread is a terrible place to keep a project's state: it grows, it forks
implicitly, and a dead end costs you the whole context. ContextGit gives
conversations a real history — commits, branches, tags, diffs, merges — and makes
that history a mergeable artefact alongside your code.

## Features

- **Conversation DAG** — immutable, content-addressed commits over messages;
  branches, tags, checkout, `log`, `diff`, rollback.
- **Docs tab (in Chat)** — a **Chat | Docs** switch inside the Chat tab. Docs asks
  the assistant to write a document on any topic and download it as **Markdown,
  PDF, Word or PowerPoint** in a **professional house style** (Report / Brief /
  Proposal: cover page, table of contents, page numbers, styled code and tables),
  with a library of everything you've generated.
  See [`files/chat-documents.md`](files/chat-documents.md).
- **Token usage** — every LLM call is counted and merged into one **Usage** view:
  real provider usage where the API reports it (chat, council), estimates for
  research and CLI/PTY turns, broken down per connected AI, model and surface.
  See [`files/usage.md`](files/usage.md).
- **Chat conversations** — each new conversation is an isolated session forked
  from the root, so nothing leaks in from another thread. Turns are **staged** and
  land on the branch only when you press **Commit**; a pending-changes diff shows
  exactly what is about to land, for Chat, Council, Research and Image alike.
  See [`files/chat-sessions.md`](files/chat-sessions.md).
- **Semantic merge** — merges two branches by extracting decisions/facts/dead
  ends and detecting contradictions; conflicts are never auto-resolved.
- **Parallel agent runs** — one **git worktree + branch per run**, so agents
  never overwrite each other's files.
- **Fleet visibility** — changed files, ahead/behind, conflict verdict and
  file-overlap between runs.
- **Claims** — each run claims a path scope; overlaps are flagged and a managed
  `AGENTS.md` block tells agents who owns what.
- **Merge queue** — sequential, checkout-free integration with `git merge-tree`
  pre-flight and conflict blocking.
- **Paired code + context merge** — merging a run lands its diff on the git
  branch *and* its reasoning on the context branch.
- **Desktop workbench** — Electron app with Code / Git / Issues / Assets workflows.
  Storage is embedded in Git, and live terminals (xterm + node-pty) run per agent.
  The beta launches user-installed terminal agents and keeps their work branchable;
  native transcript capture is verified per agent, with OpenCode currently the
  strongest integration. The embedded editor and Why analysis are deferred from
  this beta.
- **CLI harnesses** — Claude Code, Codex, OpenCode, Gemini CLI, Aider, Ollama,
  Freebuff, Cline, Pi, Kilo Code and Command Code, each with its real brand icon.
  A harness you don't have is installed in the background with a progress bar —
  no installer terminal. See [`files/code-harnesses.md`](files/code-harnesses.md).
- **Harness usage limits** — the Code tab shows each CLI's own account limits
  (Command Code's 5-hour / Weekly windows, credits and lifetime tokens; Cline's
  plan), read locally from the CLI's stored login.
  See [`files/code-harness-limits.md`](files/code-harness-limits.md).
- **Scheduled Issues** — the Issues tab scans the open repository for masked
  secrets and dependency advisories, keeps scan history, and can create
  deduplicated high-confidence GitHub Issues locally or through a generated
  GitHub Actions workflow.
- **Run isolation** — a private local `PORT` per run and a work-in-progress cap.

## Scheduled Issues

The Issues tab can run a safe repository scan manually or on a fixed five-hour
schedule. It persists normalized findings and stable fingerprints, masks
secrets, and only creates high-confidence high/critical GitHub Issues when
automatic creation is enabled. The tab can also install a least-privilege
GitHub Actions workflow for scans while the desktop is closed.

## Architecture

```
React / Electron renderer  ──HTTP/SSE──▶  FastAPI (thin)  ──▶  core (Repo, coordinator)
        (desktop/, app/)                                  ──▶  storage (SQLite)
                                                          ──▶  llm (provider adapters)
                                                          ──▶  merge (semantic engine)
                                                          ──▶  gitops (worktrees, integrate)
```

- **Core owns all logic**; API routes and React components stay thin.
- **Local-first**: single SQLite file, no cloud, no accounts.
- Dependencies point downward only: UI → API → core → storage / llm / merge.

## Repository layout

| Path | What |
|---|---|
| `contextgit/` | Python package: core, storage, merge engine, LLM adapters, API, CLI, `gitops/` |
| `contextgit/verify/` | Quality gate: project command detection + a bounded command runner |
| `contextgit/mcp/` | Team tools over MCP (stdio server + the project's `.mcp.json`) |
| `desktop/` | Electron workbench (renderer + main process + PTY manager) |
| `app/`, `components/`, `lib/` | Next.js landing page (marketing only) |
| `tests/` | pytest suite (core, storage, merge, API, CLI, gitops, team, verify, MCP) |
| `e2e/` | Playwright desktop end-to-end tests |
| `files/` | Design docs, data model, roadmap, team-mode research |
| `landing/` | Early static prototype (not wired to anything) |

## Quickstart

### Backend (Python 3.11+)

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev,mcp]"    # drop ",mcp" to skip the optional MCP server

uvicorn contextgit.api.main:app --reload --port 8756   # or: ctx-api
ctx --help                                             # CLI
contextgit-mcp --help                                  # team tools over MCP (stdio)
```

### Desktop app

```bash
cd desktop
npm install
npm run dev        # Vite + Electron + a local backend
```

### Create a conversation repository

```bash
mkdir my-project && cd my-project
ctx init .                 # creates .contextgit/contextgit.db with a root commit
ctx commit -m "first turn" # or use the desktop UI
```

## Development

```bash
.venv/bin/pytest -q              # backend tests
.venv/bin/mypy                   # strict type check
.venv/bin/ruff check             # lint

cd desktop && npm run build      # typecheck + renderer + electron bundles
npx tsc --noEmit                 # root (landing + e2e) typecheck
npx playwright test              # desktop e2e (build desktop first)
```

See [`files/README.md`](files/README.md) for the full doc index and
[`files/AGENTS.md`](files/AGENTS.md) for contribution rules.
Community expectations are in [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## License

Apache License 2.0 — see [`LICENSE`](LICENSE).
