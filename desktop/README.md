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
