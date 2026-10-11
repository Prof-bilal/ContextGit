# Desktop app

The Electron workbench remains the rollback path while the parallel Tauri 2
shell is developed. Both shells use the same React renderer and typed HTTP
client in `shared/`.

## Development

Install dependencies and start the local app from the repository root:

```bash
bun install --cwd desktop
bun run dev --cwd desktop
```

The app starts a local FastAPI backend and connects to it through the preload
bridge. Do not expose that backend to an untrusted network.

## Checks

```bash
bun run --cwd desktop typecheck
bun run --cwd desktop build
bun run --cwd desktop test:lifecycle
bun run --cwd desktop test:markdown
```

Build the desktop package before running the root Playwright suite:

```bash
bun run --cwd desktop build
bunx playwright test
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

The Tauri shell bundles the API backend for release builds and stores runtime
data under the platform app-data directory. Electron remains the rollback
shell until feature parity and packaging gates pass.

Build a release installer with:

```bash
bun run --cwd desktop tauri:build
```
