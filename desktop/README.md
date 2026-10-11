# Desktop app

The Electron workbench is the primary ContextGit UI. It owns the renderer,
main process, preload bridge, terminal integrations, packaging, and the typed
HTTP client in `shared/`.

## Development

Install dependencies and start the local app from the repository root:

```bash
npm install --prefix desktop
npm run dev --prefix desktop
```

The app starts a local FastAPI backend and connects to it through the preload
bridge. Do not expose that backend to an untrusted network.

## Checks

```bash
npm run typecheck --prefix desktop
npm run build --prefix desktop
npm run test:lifecycle --prefix desktop
npm run test:markdown --prefix desktop
```

Build the desktop package before running the root Playwright suite:

```bash
npm run build --prefix desktop
npx playwright test
```

See [`../docs/desktop.md`](../docs/desktop.md) for the architecture and
packaging flow.
