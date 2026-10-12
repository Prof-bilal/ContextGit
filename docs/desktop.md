# Desktop Guide (Tauri)

**Stack:** Tauri 2 + Vite 7 + React 19, PyInstaller (backend), and the native
Tauri bundler. The desktop owns its renderer and
typed API client under `desktop/shared/`; it does not import website code.

## Layout
```
desktop/
  src-tauri/src/main.rs # spawns backend, owns windows, PTYs, and status events
  src/tauri-bridge.ts   # window.contextgit renderer bridge
  shared/status.ts      # BackendStatus union shared by main/preload/renderer
  src/                  # renderer entry (App gates Workbench on backend status)
  scripts/build-backend.mjs # PyInstaller onefile → desktop/build/backend/contextgit-api
  backend/entry.py      # PyInstaller entrypoint (calls contextgit.api.server:main)
  package.json          # renderer and Tauri build scripts
```

## Backend lifecycle
1. Tauri creates the window first (renderer shows "Starting local backend…").
2. Spawns the backend:
   - **dev:** `.venv/bin/uvicorn contextgit.api.main:app` on a reserved local port.
   - **packaged:** `resources/backend/contextgit-api` (PyInstaller binary, same env contract).
   - Env: `CONTEXTGIT_REPO` defaults to `<userData>/contextgit`; `CONTEXTGIT_CORS_ORIGINS` covers the Vite dev origin and `file://`.
3. Polls `GET /api/v1/health` (30s budget) → status `ready` (window renders Workbench) or `error` (error screen with **Restart backend**).
4. Renderer reads `apiBase` from the Tauri bridge (`window.contextgit.apiBase`).
5. Tauri owns shutdown and kills the backend process group and active PTYs.
6. A second launch focuses the existing instance; the New Window command opens a
   second renderer connected to the same backend and project.

## Rules
- Renderer talks HTTP/SSE to FastAPI only — no direct storage/LLM access (layers unchanged).
- Preload is sandboxed (`contextIsolation`, no `nodeIntegration`); everything crosses via `window.contextgit`.
- One React instance: `vite.config.ts` aliases `react`/`react-dom` to `desktop/node_modules`.
- `@/*` aliases to the desktop package, keeping the renderer independent from the website.

## Commands
```bash
cd desktop
npm install            # once
npm run tauri:dev      # Vite + Tauri + dev backend
npm run build          # typecheck + renderer + backend bundle
npm run build:backend  # PyInstaller binary (needs ../.venv)
bun run tauri:build    # cross-platform Tauri installers
```

## Verification standard (every phase)
`cd desktop && npm run typecheck && npm run build:renderer && npm run tauri:check`
must pass, plus `.venv/bin/pytest -q`.
