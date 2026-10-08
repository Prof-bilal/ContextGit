# AGENTS.md — Start Here

ContextGit is version control for LLM conversations. A conversation is a tree of
commits; users can branch, diff, merge, and roll back context. It ships as a
Python core library, a CLI, and a FastAPI + React web UI.

## Read these before coding
| File | Read when |
|---|---|
| architecture.md | Always. System layout and boundaries. |
| data-model.md | Touching commits, branches, storage, hashing. |
| backend.md | Working on core library, CLI, or API. |
| desktop.md | Working on the Electron desktop app. |
| workspace-architecture.md | Working on the dockable panel canvas, editor, browser, files, API/DB panels. |
| frontend.md | Working on the web UI. |
| merge-engine.md | Working on diff, merge, or summarization. |
| testing.md | Writing or running tests. |
| codestyle.md | Always, before writing any code. |
| design.md | Building the landing page or any marketing UI. |
| roadmap.md | Deciding what to build next. |
| plans.md (repo root, gitignored) | **Starting work now** — the local state file: uncommitted work, what is verified, gotchas. May not exist on a fresh clone. |
| embedding-clients.md | Working on the embedded DB/API clients (DbGate, Restfox) or the browser chrome. |
| remaining-phases.md | Deciding what to build next **now** — the endpoint graph, the "Why" lens, MCP memory, bisect/replay, and the backlog. |

## Ground rules
1. The **core library is the single source of truth**. CLI and API are thin wrappers.
2. Never put business logic in API routes, CLI commands, or React components.
3. Commits are **immutable**. Never edit a commit; create a new one.
4. Every LLM call goes through the `llm/` adapter, never called directly.
5. Write or update tests with every change. No untested merge/diff logic.
6. Keep changes small. One concern per change.
7. If a requirement is unclear, ask instead of guessing.
