# Desktop app

The Tauri 2 shell is the supported desktop runtime. It uses the React renderer,
the typed HTTP client in `shared/`, and a bundled FastAPI backend for releases.

## Development

Install dependencies and start the local app from the repository root:

```bash
bun install --cwd desktop
bun run --cwd desktop tauri:dev
```

The app starts a local FastAPI backend and connects to it through the Tauri
bridge. Do not expose that backend to an untrusted network.

## Checks

```bash
bun run --cwd desktop typecheck
bun run --cwd desktop build
bun run --cwd desktop tauri:check
bun run --cwd desktop build:renderer
```

See [`../docs/desktop.md`](../docs/desktop.md) for the architecture and
packaging flow.

## Tauri shell

The initial Tauri target lives in `src-tauri/`. Install the Tauri CLI and the
platform WebView prerequisites, then run:

```bash
bun run --cwd desktop tauri:dev
bun run --cwd desktop tauri:check
```

The Tauri shell bundles the API backend for release builds, stores runtime data
under the platform app-data directory, and coordinates additional windows
through one shared backend process.

Build a release installer with:

```bash
bun run --cwd desktop tauri:build
```

## Project conversations and learning

The Workspace view opens on recent conversations. Use **Start new task** to begin
or **Resume conversation** to return to earlier work. Git graphs and merge controls
are available under **Advanced Git**; the inspector starts collapsed.

Closing an agent saves a checkpoint before showing a review. Give it an optional
1–5 rating, reason tags, a category, and a note. Review the redacted Markdown,
optionally select **Clean with AI**, and close to export it under
`.contextgit/knowledge/conversations/`. The original captured source stays in the
local database. **Keep working** dismisses the review without stopping the agent.

**Generate learning draft** uses the selected configured provider (or the app's
default `CTX_LLM_API_KEY` provider). It requires an exact source excerpt and produces
one editable lesson. Approve or reject it in the review or under **Project history
& knowledge**. Approved lessons are written as `SKILL.md` files in
`.contextgit/knowledge/skills/`, indexed in the managed `AGENTS.md` block, and added
to matching worktree context. Drafts and ratings alone never activate guidance.
Changed feedback or approved knowledge requires a fresh draft before approval.

Set up a connection from **Project history & knowledge → AI connection**, or use
**Set up AI connection** in a checkpoint review. Choose a provider, enter your API
key and model, optionally edit the API endpoint, and use **Test connection** to
verify access. **Save connection** remembers the project default across restarts.
Cleaning and learning use that default automatically. Editing an existing connection
with an empty key field preserves its saved key. Keys are stored in the local
provider database and are never returned in settings responses or browser storage.
Ollama can use a running local server without an API key. A custom OpenAI-compatible
endpoint is also supported.

New tasks suggest categories from matching project history. Choosing a category
or file scope shows prior low-rated attempts and relevant approved lessons.
Learning is isolated to its project. Markdown and skills live under the existing
ignored `.contextgit/` folder; they are local artifacts, not automatically committed.

Structured capture currently supports OpenCode. Other agents use a bounded terminal
recording, labeled partial. Automatic redaction covers common credentials, but the
preview remains editable so users can remove other private content. Capture and
export failures retain the checkpoint and allow retry. AI cleaning and learning
require an available provider; saving, ratings, and resume work without one.

Run `npm run test:knowledge --prefix desktop` for the browser workflow test and
`pytest tests/test_knowledge.py` for the backend contract tests.
