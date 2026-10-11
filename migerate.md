# Electron to Tauri + Rust Migration Plan

## Summary

Migrate the desktop shell from Electron to Tauri 2 while preserving the Python
backend, FastAPI/SSE contract, React workbench, shared TypeScript models, and
existing product behavior.

The migration will be parallel and incremental:

- Keep Electron working as the rollback path.
- Build Tauri beside the existing desktop app.
- Preserve all current terminal and agent functionality.
- Open browser content in the system browser in the first Tauri release.
- Support Linux x64/ARM64, Windows x64, and macOS x64/ARM64.
- Require at least 40% lower packaged idle RSS than Electron.
- Keep the Python API as a packaged sidecar; do not rewrite the backend in Rust.

Tauri should reduce bundled runtime overhead by using the operating system WebView
instead of shipping Chromium. This must be verified with comparable packaged
memory measurements; the React renderer, agent processes, terminals, and browser
content still have independent memory costs.

## Current migration boundary

The migration is concentrated in the Electron-specific desktop layer:

- `desktop/electron/main.ts`: window lifecycle, IPC, backend lifecycle, projects,
  assets, browser views, PTYs, and updates.
- `desktop/electron/preload.ts`: renderer bridge and event channels.
- `desktop/electron/pty.ts`: interactive PTY lifecycle and agent startup.
- `desktop/electron/viewmanager.ts`: embedded browser tabs and security policy.
- `desktop/electron/library.ts`: asset storage and custom asset protocol.
- `desktop/electron/harness.ts`: command discovery and installation.
- `desktop/electron/usage.ts`: usage polling and reporting.
- `desktop/electron/updater.ts`: update checks and installation.
- `desktop/scripts/`: Electron build, packaging, smoke, lifecycle, and release.
- `e2e/`: Electron-specific launch and acceptance tests.

The following remain unchanged initially:

- `contextgit/` Python core and FastAPI backend;
- SQLite storage and migrations;
- API routes and SSE behavior;
- `desktop/src/` React workbench;
- `desktop/shared/` API and domain types;
- website code;
- backend unit and integration tests.

## Target architecture

```text
React + Vite renderer
        |
        | Tauri invoke / listen
        |
Rust application shell
        |
        +-- Backend supervisor
        +-- PTY/session supervisor
        +-- Workspace/filesystem commands
        +-- Asset commands
        +-- Harness commands
        +-- Update commands
        +-- External browser opener
        |
Packaged Python/FastAPI sidecar
```

Rust becomes the privileged desktop boundary. The renderer must not receive
arbitrary filesystem paths, unrestricted process execution, or broad shell
access.

Use explicit Tauri capabilities. Shell commands, filesystem paths, URLs, and
sidecar execution must be allowlisted and validated.

## Phase 0 — Baseline and migration contract

Before implementation, measure the current Electron app in packaged mode:

- idle RSS after launch;
- RSS after the workbench becomes ready;
- RSS with 1, 4, and 8 terminal sessions;
- RSS during sustained terminal output;
- RSS while browser functionality is exercised;
- backend startup and restart time;
- CPU during terminal streaming;
- orphaned processes after shutdown;
- installer size.

The primary success gate is at least 40% lower idle RSS than Electron. Secondary
gates are no unbounded terminal-output memory growth, no orphaned processes, and
no unacceptable startup or restart regression.

Freeze the current `window.contextgit` shape as the renderer compatibility
contract before migrating individual features.

## Phase 1 — Parallel Tauri shell

Create a Tauri desktop target beside Electron. Do not remove or substantially
alter Electron yet.

Implement:

- one Tauri window;
- Vite renderer loading in development and production;
- app version and platform information;
- minimum and initial window dimensions;
- close/reopen behavior;
- window-state persistence;
- capability configuration;
- command error logging.

Exit criteria:

- the React workbench renders in Tauri;
- the renderer entrypoint has no required Electron APIs;
- Electron still builds;
- Tauri development and production asset loading work.

## Phase 2 — Replace preload IPC with typed Tauri commands

Create a renderer adapter that preserves the current TypeScript-facing bridge
shape while replacing Electron IPC internally.

Provide equivalent operations for:

- backend status and restart;
- runtime information;
- project listing and selection;
- workspace selection and creation;
- file save;
- asset catalog and mutation;
- external URL opening;
- harness checks and installation;
- update status and actions;
- PTY operations and event subscriptions.

Use request/response commands for finite operations and Tauri events for streams:

```text
invoke: get_workspace, list_projects, create_workspace, save_file,
        assets_catalog, harness_check

events: backend-status, pty-output, pty-exit, usage-update,
        harness-progress, update-status
```

Keep event payloads equivalent to the existing shared TypeScript types whenever
possible so feature components do not depend on the desktop shell.

Security requirements:

- validate paths in Rust;
- reject paths outside approved workspace or application-data roots;
- validate command IDs and argument lists;
- never expose arbitrary command execution;
- avoid logging secrets;
- preserve authenticated backend-token behavior.

## Phase 3 — Move backend lifecycle into Rust

Implement a Rust backend supervisor with the current Electron behavior.

Development mode:

- locate the configured Python executable or project virtualenv;
- launch Uvicorn with `contextgit.api.main:app`;
- bind only to `127.0.0.1`;
- pass `CONTEXTGIT_HOST`, `CONTEXTGIT_PORT`, `CONTEXTGIT_REPO`,
  `CONTEXTGIT_API_TOKEN`, and CORS settings;
- clearly report occupied ports.

Packaged mode:

- launch the bundled PyInstaller sidecar;
- use application data for the default repository;
- use the active project `.contextgit` directory when a project is selected.

Lifecycle:

1. Start the supervisor.
2. Launch the backend child.
3. Poll `/api/v1/health`.
4. Validate repository and instance identity.
5. Emit `starting`, `ready`, or `error`.
6. Monitor health periodically.
7. Serialize restart operations.
8. Gracefully terminate, then force-kill after timeout.
9. Ensure shutdown leaves no child process or listening port.

The renderer continues using HTTP/SSE to FastAPI; no backend API rewrite is
required.

Exit criteria:

- backend startup works in development and packaged mode;
- restart works repeatedly;
- project switching safely rebinds the backend;
- startup errors are actionable;
- shutdown leaves no Python process or open port.

## Phase 4 — Port PTY and agent sessions

This is the highest-risk subsystem. Implement it separately from generic shell
commands using a Rust PTY implementation such as `portable-pty`.

Each session should track:

- session ID;
- command and arguments;
- working directory;
- environment;
- terminal dimensions;
- process handle;
- lifecycle state;
- output and exit channels.

Required commands:

```text
pty_start
pty_write
pty_resize
pty_kill
pty_list_presets
```

Required events:

```text
pty-output { id, data }
pty-exit { id, code }
```

Preserve:

- default shell selection;
- Claude, Codex, Gemini, OpenCode, and custom presets;
- environment merging;
- working-directory selection;
- terminal dimension validation;
- resize and kill behavior;
- startup briefing injection;
- OpenCode session binding;
- usage tracking;
- process-tree cleanup.

Batch PTY output before emitting events. Do not emit one IPC event per
character; use a short time window or bounded byte threshold.

PTY acceptance coverage must include shell startup, every supported harness,
custom commands, input, resize, exit, kill, duplicate session IDs, multiple
simultaneous sessions, sustained output, shutdown during an active PTY, and
Windows process cleanup.

Full current terminal parity is required before Electron can be retired.

## Phase 5 — Replace embedded browser tabs

Do not reproduce Electron `WebContentsView` in the first Tauri release.

The current feature has a large memory and security surface: multiple webviews,
navigation, persistent browser partitions, popup handling, permissions,
devtools, find-in-page, zoom, and bounds synchronization.

For Tauri v1:

- accept only HTTP and HTTPS URLs;
- open them through the system browser;
- preserve the user-visible destination and action;
- remove or hide controls that require an embedded view;
- document the behavior as an intentional product change.

A later phase may evaluate separate Tauri webview windows. Embedded browser tabs
must not block the initial memory-focused migration.

## Phase 6 — Port remaining desktop services

### Workspaces and files

Implement Rust commands for project listing, activation, forgetting, workspace
selection, workspace creation, document saving, and reveal-in-file-manager.

Preserve existing application-data locations and migration behavior.

### Asset library

Keep the existing JSON manifest and asset directory format. Rust owns import,
catalog, folders, move, rename, tags, notes, delete, and agent actions.

Never expose arbitrary asset paths. Return controlled asset handles or validated
application-owned URLs.

### Harness management

Port PATH augmentation, command discovery, npm prefix detection, installation,
progress, cancellation, and post-install verification.

All executable names and argument patterns must be explicitly scoped.

### Usage tracking

Keep existing provider-specific parsers and data formats initially. Move only
process/file access and polling orchestration as needed.

### OpenCode capture

Preserve session identity, directory identity, conflict detection, atomic receipt
creation, no transcript capture, and no secret leakage.

The Rust PTY launch path must generate equivalent OpenCode configuration and
arguments.

## Phase 7 — Updates and packaging

Replace Electron-builder and `electron-updater` with Tauri bundling and updater
artifacts.

Requirements:

- signed update artifacts;
- stable public verification key in the app;
- private signing key outside the repository;
- beta and stable channel support;
- current-version checks;
- download progress;
- install state;
- release-page fallback;
- explicit restart behavior.

Keep the existing release matrix: Linux x64/ARM64, Windows x64, and macOS
x64/ARM64.

Replace Electron scripts with Tauri equivalents for frontend build, Rust checks,
sidecar build, bundle build, checksums, updater metadata, and packaged smoke
tests.

Keep Electron packaging in CI until Tauri passes a complete beta cycle.

## Phase 8 — Tests

### Rust unit tests

Cover backend command construction, environment construction, path validation,
project persistence, asset operations, command allowlisting, updater state,
PTY state transitions, event serialization, and shutdown cleanup.

### Renderer tests

Test the bridge adapter with mocks for Tauri invoke/listen, backend status, PTY
output, file dialogs, and updater states. Existing component tests should remain
focused on UI behavior rather than shell implementation.

### Integration tests

Cover Tauri-to-Python startup, health gating, restart, project switching, asset
operations, workspace creation, PTY lifecycle, concurrent sessions, updater
status, and external browser launch.

### Packaged acceptance tests

Replace the Electron launcher with a Tauri-aware harness. Verify application
startup, backend readiness, workbench rendering, project selection, chat/API
operation, history/branch views, terminal input, resize, exit, restart, updater
state, clean shutdown, and installable artifacts on every platform.

### Memory tests

Compare packaged Electron and Tauri on the same machine with the same project,
renderer state, terminal count, observation period, and backend state.

The Tauri release fails the primary gate if idle RSS is not at least 40% lower or
if sustained terminal output causes unbounded growth.

## Rollout

1. Tauri shell renders the existing workbench.
2. Tauri backend sidecar reaches `ready`.
3. Tauri bridge supports workspaces, files, and assets.
4. Tauri PTY supports one shell.
5. Tauri reaches full harness parity.
6. Tauri packages on all supported platforms.
7. Memory and reliability comparisons pass.
8. Tauri beta is released beside Electron.
9. Electron remains available for one beta rollback cycle.
10. Electron is removed only after all release gates pass.

## Ownership split

- Shell/runtime: Tauri app, commands, capabilities, and window lifecycle.
- Backend: Python sidecar supervisor, health, restart, and shutdown.
- Terminal: Rust PTY manager, batching, and process cleanup.
- Filesystem: workspaces, assets, dialogs, exports, and path security.
- Integrations: harness installation, usage, and OpenCode capture.
- Release: bundles, signatures, updater, and CI matrix.
- QA: parity tests, packaged tests, memory benchmarks, and soak tests.

Each subsystem should land independently behind the frozen bridge contract.

## Release gates

Electron must not be retired until all of the following are true:

- packaged idle RSS is at least 40% lower;
- full terminal and harness parity is verified;
- backend startup, restart, and shutdown match current behavior;
- no Python or agent processes are orphaned;
- existing project, asset, and repository data remains compatible;
- all five platform targets build and install;
- updater artifacts are signed and verified;
- packaged smoke tests pass;
- sustained PTY output has bounded memory;
- external-browser behavior is documented and tested;
- Electron rollback remains available through the first Tauri beta cycle.

## Assumptions

- The Python backend remains the source of truth.
- The React workbench remains the product UI.
- Tauri 2 is the target shell.
- Electron and Tauri are developed in parallel.
- Embedded browser tabs are deferred from Tauri v1.
- Full terminal parity is required.
- Current release platforms remain supported.
- 40% lower idle RSS is the primary success metric.
- Existing user data and repository layout remain compatible.
