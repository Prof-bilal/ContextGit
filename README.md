# ContextGit

**Version control for LLM conversations.** Branch, diff, merge and roll back
context the way you already do with code — then run several AI agents on the same
project without them colliding.

ContextGit pairs a **conversation DAG** (content-addressed, immutable commits of
messages) with a **git worktree per agent run**, so parallel agents work in
isolated checkouts and their reasoning merges together with their diffs.

> Status: early / experimental. Interfaces and schema may change.

## Why

A chat thread is a terrible place to keep a project's state: it grows, it forks
implicitly, and a dead end costs you the whole context. ContextGit gives
conversations a real history — commits, branches, tags, diffs, merges — and makes
that history a mergeable artefact alongside your code.

## Features

- **Conversation DAG** — immutable, content-addressed commits over messages;
  branches, tags, checkout, `log`, `diff`, rollback.
- **Semantic merge** — merges two branches by extracting decisions/facts/dead
  ends and detecting contradictions; conflicts are never auto-resolved.
- **Parallel agent runs** — one **git worktree + branch per run**, so agents
  never overwrite each other's files.
- **Fleet visibility** — changed files, ahead/behind, conflict verdict and
  file-overlap between runs.
- **Claims** — each run claims a path scope; overlaps are flagged (blocked in
  team mode) and a managed `AGENTS.md` block tells agents who owns what.
- **Merge queue** — sequential, checkout-free integration with `git merge-tree`
  pre-flight and conflict blocking.
- **Paired code + context merge** — merging a run lands its diff on the git
  branch *and* its reasoning on the context branch.
- **Desktop workbench** — Electron app with Chat / Code / Agent / Git tabs, live
  terminals (xterm + node-pty) per run.
- **Team mode** — missions, tasks, roles, dependencies and a verifier agent;
  research and architecture in [`files/team-mode-*.md`](files).

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
| `desktop/` | Electron workbench (renderer + main process + PTY manager) |
| `app/`, `components/`, `lib/` | Next.js landing page (marketing only) |
| `tests/` | pytest suite (core, storage, merge, API, CLI, gitops) |
| `e2e/` | Playwright desktop end-to-end tests |
| `files/` | Design docs, data model, roadmap, team-mode research |
| `landing/` | Early static prototype (not wired to anything) |

## Quickstart

### Backend (Python 3.11+)

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

uvicorn contextgit.api.main:app --reload --port 8756   # or: ctx-api
ctx --help                                             # CLI
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

## License

Apache License 2.0 — see [`LICENSE`](LICENSE).
