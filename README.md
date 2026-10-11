# ContextGit

ContextGit is version control for LLM conversations: branch, diff, merge, and
roll back context while running multiple AI agents without collisions.

The repository is split into independent packages so contributors can quickly
find the code they need:

```text
contextgit/   Python core library, API, CLI, storage, and integrations
desktop/      Electron workbench, renderer, IPC, and desktop API client
website/      Next.js marketing site
tests/        Python unit and integration tests
e2e/          Playwright desktop acceptance tests
docs/         Architecture, contributor, product, and engineering docs
```

The desktop app is the primary product UI. The website is marketing-only; it
does not serve the workbench.

## Start here

Read [`docs/AGENTS.md`](docs/AGENTS.md) before changing code. Then choose the
package that owns your work:

- Python backend, CLI, API, storage, or merge logic: `contextgit/`
- Electron UI, preload, IPC, terminals, or desktop behavior: `desktop/`
- Marketing pages and website components: `website/`
- Backend tests: `tests/`
- Desktop acceptance tests: `e2e/`

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

### Desktop app

```bash
npm install --prefix desktop
npm run dev --prefix desktop
```

The desktop app starts its local backend automatically. See
[`docs/desktop.md`](docs/desktop.md) for the architecture and packaging flow.

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
npm run build --prefix desktop
npx tsc --noEmit
npx playwright test
```

## Product boundaries

- The core library is the source of truth; API, CLI, and UI layers stay thin.
- Commits are immutable and content-addressed; branches and HEAD are pointers.
- The product is local-first. Only configured model calls leave the machine.
- The website contains marketing pages only. Desktop owns the workbench and its
  typed API client.

## Contributing

Keep changes small and focused, add regression tests for behavior changes, and
use conventional commits. See [`docs/AGENTS.md`](docs/AGENTS.md),
[`docs/codestyle.md`](docs/codestyle.md), and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## License

Apache License 2.0. See [`LICENSE`](LICENSE).
