# ContextGit

ContextGit is version control for LLM conversations: branch, diff, merge, and
roll back context while running multiple AI agents without collisions.

The repository is split into independent packages so contributors can quickly
find the code they need:

```text
contextgit/   Python core library, API, CLI, storage, and integrations
web/          Local web app: React workbench and its typed API client
website/      Next.js marketing site
tests/        Python unit and integration tests
e2e/          Playwright acceptance tests
docs/         Architecture, contributor, product, and engineering docs
```

ContextGit is a local web app: `contextgit web` starts the API and opens the
workbench at http://127.0.0.1:7417. There is no desktop or native app. The
website is marketing-only; it does not serve the workbench.

## Start here

Read [`docs/AGENTS.md`](docs/AGENTS.md) before changing code. Then choose the
package that owns your work:

- Python backend, CLI, API, storage, or merge logic: `contextgit/`
- Workbench UI, terminals, or browser behavior: `web/`
- Marketing pages and website components: `website/`
- Backend tests: `tests/`
- Acceptance tests: `e2e/`

Architecture and testing rules live in [`docs/architecture.md`](docs/architecture.md),
[`docs/codestyle.md`](docs/codestyle.md), and [`docs/testing.md`](docs/testing.md).

## Development setup

### Backend

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev,mcp]"
python -m pytest -q
```

### Web app

```bash
npm install --prefix web
npm run build --prefix web
contextgit web
```

`contextgit web` serves the workbench at http://127.0.0.1:7417 and the local
API at http://127.0.0.1:7418. The ports are fixed so the address and the
browser's saved session never change; pass `--port` / `--api-port` to override.
See [`docs/web.md`](docs/web.md) for the architecture.

### Website

```bash
npm install --prefix website
npm run dev --prefix website
```

The website is available at `http://localhost:3000`.

### Full verification

```bash
python -m pytest -q
python -m ruff check contextgit tests
python -m mypy contextgit
npm run build --prefix website
npm run build --prefix web
npx tsc --noEmit
npx playwright test
```

## Product boundaries

- The core library is the source of truth; API, CLI, and UI layers stay thin.
- Commits are immutable and content-addressed; branches and HEAD are pointers.
- The product is local-first. Only configured model calls leave the machine.
- The website contains marketing pages only. `web/` owns the workbench and its
  typed API client.

## Contributing

Keep changes small and focused, add regression tests for behavior changes, and
use conventional commits. See [`docs/AGENTS.md`](docs/AGENTS.md),
[`docs/codestyle.md`](docs/codestyle.md), and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## License

Apache License 2.0. See [`LICENSE`](LICENSE).
