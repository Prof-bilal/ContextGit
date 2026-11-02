# ContextGit web app

The ContextGit workbench is a React/Vite web application backed by the local
FastAPI service. It runs in the user's browser at http://127.0.0.1:7417; there is no desktop or
native app.

## Development

From the repository root:

```bash
python -m venv .venv
.venv/bin/pip install -e '.[dev]'
npm install --prefix web
.venv/bin/contextgit web
```

The launcher starts the API and serves the renderer on localhost, then opens
the browser. The API and terminal bridge are authenticated with a per-launch
token and remain loopback-only.

## Checks

```bash
npm run typecheck --prefix web
npm run build --prefix web
.venv/bin/pytest -q tests
```

The UI preserves the existing project, conversation, team, terminal, editor,
and knowledge workflows. Browser-native speech recognition is used when
available; code-server integration is optional and reports clearly when it is
not installed.
