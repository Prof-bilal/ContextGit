# Architecture

## Layers
```
  Tauri Desktop        CLI (typer)       Next.js Website
          \              /                    |
           FastAPI (HTTP/SSE)                 |
                    |                         |
             Core Library              marketing-only UI
              (contextgit/core)
          /         |          \
     Storage    LLM Adapter    Merge Engine
     (SQLite)   (providers)    (diff + summarize)
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
desktop/         # Tauri workbench and desktop-owned API client
website/         # Next.js marketing site
tests/            # Python unit and integration tests
docs/             # Architecture, contributor, product, and engineering docs
```

## Key design decisions
- **Content-addressed commits** (SHA-256 of parent + messages + metadata), like git.
- **Branches and HEAD are mutable pointers**; commits are not.
- **Merges produce a summary commit**, not a concatenation of the branch.
- **Provider-agnostic**: swapping LLM providers requires only a new adapter.
- **Local-first**: everything works offline except LLM calls.
- **Streaming** via Server-Sent Events for backend and terminal events.

## Out of scope (for now)
Multi-user auth, cloud sync, real-time collaboration.
