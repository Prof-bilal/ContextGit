# Browser workbench guide

**Stack:** React 19 + Vite 7, xterm.js, and the local FastAPI API. The workbench
is served over localhost and opened in the user's browser; it does not require
a bundled native shell or a second runtime.

## Lifecycle

1. `contextgit web` creates a loopback API listener with a random launch token.
2. The launcher serves the built renderer and opens a browser tab.
3. The renderer reads the API URL and token from the page URL, then talks to
   FastAPI over authenticated HTTP and WebSocket requests.
4. Project files are read and written through the API with path checks and
   optimistic version checks.
5. Interactive terminals use the authenticated terminal WebSocket and are
   kept visible in the workbench while the canvas remains available.

## Commands

```bash
contextgit web                 # start API, renderer, and browser
contextgit web --port 5174     # choose the renderer port
contextgit web --api-port 8756 # choose the API port
cd desktop && npm run typecheck && npm run build
```

The browser bridge is loopback-only and tokenized. Never expose the API port to
an untrusted network. The optional code-server editor is controlled through the
same local API and returns an explicit unavailable status when not installed.

## Verification

Run the renderer typecheck/build and `.venv/bin/pytest -q tests`. For a manual
smoke test, open a project, start a terminal, run a command, open a file, edit
it, and reload the browser to verify that the project session is restored.
