# Desktop Guide (Electron)

**Stack:** Electron 39 + Vite 7 + React 19, esbuild (main/preload), PyInstaller
(backend), and electron-builder (packaging). The desktop owns its renderer and
typed API client under `desktop/shared/`; it does not import website code.

## Layout
```
desktop/
  electron/main.ts      # spawns backend, health-gates window, status IPC
  electron/preload.ts   # contextBridge: window.contextgit (apiBase, getStatus, restartBackend, onStatus)
  shared/status.ts      # BackendStatus union shared by main/preload/renderer
  src/                  # renderer entry (App gates Workbench on backend status)
  scripts/dev.mjs       # starts Vite, waits, launches Electron with VITE_DEV_SERVER_URL
  scripts/build-backend.sh  # PyInstaller onefile → desktop/build/backend/contextgit-api
  backend/entry.py      # PyInstaller entrypoint (calls contextgit.api.server:main)
  package.json          # scripts + electron-builder "build" config
```

## Backend lifecycle
1. `main.ts` creates the window first (renderer shows "Starting local backend…").
2. Spawns the backend:
   - **dev:** `.venv/bin/uvicorn contextgit.api.main:app` on port `CONTEXTGIT_PORT` (default 8756). If the port is already serving, it is reused instead of failing.
   - **packaged:** `resources/backend/contextgit-api` (PyInstaller binary, same env contract).
   - Env: `CONTEXTGIT_REPO` defaults to `<userData>/contextgit`; `CONTEXTGIT_CORS_ORIGINS` covers the Vite dev origin and `file://`.
3. Polls `GET /api/v1/health` (30s budget) → status `ready` (window renders Workbench) or `error` (error screen with **Restart backend**).
4. Renderer reads `apiBase` from the preload bridge (`shared/api.ts` prefers `window.contextgit.apiBase`, then `NEXT_PUBLIC_CONTEXTGIT_API`, then `http://127.0.0.1:8000`).
5. `window-all-closed` / `before-quit` kills the backend child.

## Rules
- Renderer talks HTTP/SSE to FastAPI only — no direct storage/LLM access (layers unchanged).
- Preload is sandboxed (`contextIsolation`, no `nodeIntegration`); everything crosses via `window.contextgit`.
- One React instance: `vite.config.ts` aliases `react`/`react-dom` to `desktop/node_modules`.
- `@/*` aliases to the desktop package, keeping the renderer independent from the website.

## Commands
```bash
cd desktop
npm install            # once
npm run dev            # Vite + Electron + dev backend
npm run build          # typecheck + renderer + main/preload bundles
npm run build:backend  # PyInstaller binary (needs ../.venv)
npm run dist           # electron-builder installers (run build:backend first)
CONTEXTGIT_SMOKE=1 npx electron . --no-sandbox   # headless-ish smoke: prints SMOKE_STATUS/SMOKE_PTY/SMOKE_DOM, exits 0/1
```

E2E lives at the repository root (`e2e/`, `npx playwright test`); build the
desktop app first — it launches the built app with its own backend on port 8757.

## Verification standard (every phase)
`cd desktop && npm run build` must pass, plus root `npx tsc --noEmit` and `.venv/bin/pytest -q`.
