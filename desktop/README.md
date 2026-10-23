# Browser workbench

The ContextGit workbench is a React/Vite web application backed by the local
FastAPI service. It runs in the user's browser, so the repository no longer
ships a native desktop shell.

## Development

From the repository root:

```bash
python -m venv .venv
.venv/bin/pip install -e '.[dev]'
npm install --prefix desktop
.venv/bin/contextgit web
```

The launcher starts the API and serves the renderer on localhost, then opens
the browser. The API and terminal bridge are authenticated with a per-launch
token and remain loopback-only.

## Checks

```bash
npm run typecheck --prefix desktop
npm run build --prefix desktop
.venv/bin/pytest -q tests
```

The UI preserves the existing project, conversation, team, terminal, editor,
and knowledge workflows. Browser-native speech recognition is used when
available; code-server integration is optional and reports clearly when it is
not installed.
