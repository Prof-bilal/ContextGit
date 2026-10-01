# Architecture

## Layers
```
  React Web UI         CLI (typer)
        \                 /
         FastAPI (HTTP/SSE)
                |
          Core Library  (contextgit/core)
        /       |        \
   Storage   LLM Adapter   Merge Engine
  (SQLite)   (providers)   (diff + summarize)
```
Dependencies point **downward only**. Core never imports from API, CLI, or UI.

## Repo layout
```
contextgit/
  core/          # commits, branches, HEAD, repo operations
  storage/       # SQLite repository, migrations
  llm/           # provider adapters (base.py + one file per provider)
  merge/         # diff, conflict detection, merge summarization
  health/        # contradiction / staleness checks (later phase)
  api/           # FastAPI app, routes, schemas
  cli/           # typer commands
web/             # React + TypeScript frontend
tests/
docs/ai/
```

## Key design decisions
- **Content-addressed commits** (SHA-256 of parent + messages + metadata), like git.
- **Branches and HEAD are mutable pointers**; commits are not.
- **Merges produce a summary commit**, not a concatenation of the branch.
- **Provider-agnostic**: swapping LLM providers requires only a new adapter.
- **Local-first**: everything works offline except LLM calls.
- **Streaming** via Server-Sent Events for chat responses.

## Out of scope (for now)
Multi-user auth, cloud sync, real-time collaboration.
