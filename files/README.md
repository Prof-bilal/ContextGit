# ContextGit

Version control for LLM conversations: branch, diff, merge, and roll back context.

AI assistants: start with `files/AGENTS.md`.

## Desktop app (primary UI)

The workbench ships as an Electron desktop app in `desktop/`. It spawns its own
local API backend — no separate servers to run:

```bash
python -m venv .venv
.venv/bin/pip install -e '.[dev]'
npm install --prefix desktop
npm run dev --prefix desktop
```

The API uses a local SQLite repository and the deterministic `FakeProvider` unless
`CTX_LLM_API_KEY` is set. To configure a real OpenAI-compatible model, set
`CTX_LLM_API_KEY`, and optionally `CTX_LLM_BASE_URL` and `CTX_LLM_MODEL`. The API
binds to localhost by default; do not expose it to untrusted networks because it
has no authentication.

Packaged builds:

```bash
npm run build:backend --prefix desktop   # PyInstaller API binary
npm run dist --prefix desktop            # electron-builder installers
```

See `files/desktop.md` for architecture and commands.

## Landing page

The website (`/`) is landing-only; the workbench UI is not served over HTTP:

```bash
npm run dev
```

## Tests

Playwright acceptance tests drive the desktop app (build it first):

```bash
npm run build --prefix desktop
npm run test:e2e:install
npm run test:e2e
```

## Docs

| Doc | What |
|---|---|
| `files/AGENTS.md` | Contribution rules for agents working in this repo |
| `files/architecture.md` | System architecture |
| `files/backend.md` | Backend contract (core library) |
| `files/data-model.md` | Commits, branches, sessions, team tables |
| `files/merge-engine.md` | Semantic merge and conflict handling |
| `files/frontend.md` | UI architecture |
| `files/desktop.md` | Desktop app (Electron) architecture and commands |
| `files/testing.md` | Test strategy and how to run the suites |
| `files/codestyle.md` | Style and review rules |
| `files/roadmap.md` | What is planned and what shipped |
| `files/plan.md` | The original build plan |
| `files/team-mode-landscape.md` | Team mode, round 1: prior art and the gap |
| `files/team-mode-concept.md` | Team mode, round 2: making the idea strong |
| `files/team-mode-architecture.md` | Team mode, round 3: the architecture |
| `files/team-mode-mcp.md` | Team mode: the MCP channel (tools and setup) |
| `files/chat-research-landscape.md` | Chat/research: the research types, prior art and lead-scraping guardrails |
| `files/chat-providers.md` | Chat/research: the provider layer, add-a-provider flow and catalog |
| `files/code-harnesses.md` | Code tab: the CLI harness registry, on-demand install and branding |
| `files/code-harness-limits.md` | Code tab: each CLI's account usage limits (Command Code, Cline) |
| `files/chat-sessions.md` | Chat tab: conversations as isolated sessions, staging + commit, the pending diff |
| `files/chat-documents.md` | Chat's Docs tab: generate + download md/pdf/docx/pptx, with a library |
| `files/usage.md` | Token usage: real-vs-estimated capture, the event log and the Usage tab |
| `files/all-in-one-landscape.md` | All-in-one workbench, round 1: the category, the competitor and the surface catalog |
| `files/workspace-architecture.md` | All-in-one workbench, round 2: the dockable canvas and process architecture |
| `files/editor-integration.md` | All-in-one workbench, round 3: the embedded VS Code (code-server) editor |
| `files/browser-embedding.md` | All-in-one workbench, round 4: the in-app browser (`WebContentsView`) |
| `files/api-db-clients.md` | All-in-one workbench: the HTTP and database client panels |
