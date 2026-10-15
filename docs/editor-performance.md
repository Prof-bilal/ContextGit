# Embedded workspace performance

The full code-server/VS Code workbench remains the editor. These changes reduce
ContextGit's lifecycle, layout, and background work; they do not replace VS Code
or disable user extensions, language services, or settings.

## Resource policy

- Editor and Browser are lazy-mounted once and retained across quick tab switches.
- Inactive native views are hidden immediately. After 45 seconds a clean editor
  releases both its webview and its server; Browser releases its native view.
- A small bundled VS Code integration reports dirty text documents, notebooks,
  and other dirty tabs. Unsaved files, a missing reporter, stale reports, and
  reports from an older instance prevent automatic editor eviction. Cleanup
  retries every 15 seconds while inactive so saving eventually permits release.
- Clean open files, active selection and scroll position are restored after
  recreation. Unsaved buffers are retained in their live editor instead of
  relying on unverified recovery. Nothing is silently saved or discarded.
- Switching projects with unsaved/unknown editor state keeps the previous
  project's editor open with an explanation and Retry action. Save/close the
  files and retry to open the selected project.
- Editor processes are scoped to their window and identified by instance ID.
  Delayed cleanup cannot stop a newer instance. Closing a window cleans up its
  owned server and extension-host process group.

## Work avoided

- Warm tab switches reuse the process, extension host, and native webview.
- Equal native rectangles are ignored. Only one bounds request is in flight,
  and only the newest pending rectangle survives. GTK overlay attachment and
  alignment are performed once per native view; subsequent calls change bounds.
- Show/hide commands run on visibility transitions. Inactive views have no DOM
  resize observers or scroll listeners.
- Sessions use 4-second polling in Code and 15-second polling elsewhere. Storage
  polls only while its surface is open. Git snapshots are activation/mutation
  driven. Fleet, merge queue, and usage requests stop outside Code.
- Hidden windows have no periodic backend requests. Focus/activation bursts
  reuse reads less than one second old; explicit mutation refreshes bypass that
  freshness window. Identical data keeps existing React state references.
- Browser addresses support public HTTPS sites, explicit HTTP/local servers, and
  DuckDuckGo searches. There is no automatic local-port discovery. Navigation
  reuses the existing native view and history; native events update the address,
  page title, loading and Linux load-error states. The actual native URL is
  captured before idle teardown, including navigation inside the page. Browsing
  also works without a selected project. Links requesting a new window stay in
  the managed view, and the external-open control uses the OS default browser.
- The VS Code reporter writes on dirty-state transitions, debounces layout
  snapshots, and sends a small 10-second filesystem heartbeat solely to prevent
  stale/crashed reporters from authorizing cleanup. It does not write on every
  keystroke or serialize file contents.

## Validation and measurements

Run from `desktop/`:

```sh
npm run typecheck
npm run build:renderer
npm run test:editor
npm run test:workspace
npm run test:editor-runtime
npm run test:browser
cargo check --manifest-path src-tauri/Cargo.toml --no-default-features
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features editor_tests
```

The browser tests require Playwright and Chromium. `PLAYWRIGHT_CHROMIUM_PATH`
can select an existing browser. The runtime test also requires the downloaded
editor bundle or `CONTEXTGIT_CODE_SERVER`; its diagnostic files remain in a
printed temporary directory, and its owned processes are stopped afterward.

Observed on this machine:

- Lifecycle harness: 20 warm round trips, zero additional editor processes and
  zero additional native views. Before this change, each return mounted a new
  editor and invoked startup because tab departure unmounted and stopped it.
- Stationary harness view: zero repeated bounds calls. A burst of 101 rectangles
  against delayed native IPC produces only the first and final request.
- The completed lifecycle scenario closes all six created native views and
  stops all four started editor instances, including a cancelled cold start.
- Hidden-window checks observe no session, Git, Storage, or port-discovery reads.
- Actual bundled code-server in Chromium: workbench startup approximately
  8,050 ms, dirty report approximately 934 ms after the test's typing sequence,
  save detection passed, and `main.ts` reopened after server restart.
- Three Rust editor tests pass, including clean/current/recent state checks and
  rejection of dirty, stale, malformed, future, and mismatched instance reports.
- Independent project/API backend tests pass (24 tests). The wider requested
  backend suites encounter an unrelated `tests/conftest.py` edit referencing
  undefined `auth`; that file was preserved. Repository-wide `git diff --check`
  also reports trailing whitespace in that fixture; the desktop changes pass.

The lifecycle harness mocks native webviews; the runtime check uses actual
code-server but Chromium. Neither establishes native GTK/WebKit typing latency,
total application CPU/PSS, or release-build performance. The 200 ms warm-switch
and 50 ms main-thread-stall targets still require native profiling on the
restarted application. No before/after native CPU or memory reduction is claimed.

For bounded lifecycle diagnostics, run this in the main app's developer console:

```js
localStorage.setItem("contextgit:performance", "1");
// Exercise cold opening, warm switching, resize and idle cleanup, then inspect:
window.contextgitPerformance;
// Disable again:
localStorage.removeItem("contextgit:performance");
```

The ring holds at most 200 lifecycle samples and creates no profiling timer.
`editor.ready` marks server readiness, not completion of VS Code rendering.

## Files changed for this optimization

- Native lifecycle and layout: `desktop/src-tauri/src/main.rs`,
  `desktop/src-tauri/Cargo.toml`, `desktop/src-tauri/Cargo.lock`,
  `desktop/src-tauri/editor-extension/package.json`,
  `desktop/src-tauri/editor-extension/extension.cjs`.
- Bridge contracts: `desktop/shared/editor.ts`, `desktop/src/bridge.d.ts`,
  `desktop/src/tauri-bridge.ts`.
- Workspace lifecycle and instrumentation:
  `desktop/src/shell/features/WorkspaceFeature.tsx`,
  `desktop/src/shell/workspace/WorkspaceWorkbench.tsx`,
  `desktop/src/shell/workspace/nativeLayout.ts`,
  `desktop/src/shell/workspace/performance.ts`.
- Activity and polling: `desktop/src/shell/activity.ts`,
  `desktop/src/shell/Shell.tsx`, `desktop/src/shell/useBackendPolling.ts`,
  `desktop/src/shell/terminal/useSessions.ts`,
  `desktop/src/shell/terminal/useLimits.ts`,
  `desktop/src/shell/terminal/useFleet.ts`,
  `desktop/src/shell/terminal/useMergeQueue.ts`,
  `desktop/src/shell/storage/useTrash.ts`, `desktop/src/shell/git/useRepo.ts`,
  `desktop/src/shell/features/CodeFeature.tsx`,
  `desktop/src/shell/features/GitFeature.tsx`,
  `desktop/src/shell/features/StorageFeature.tsx`.
- Validation: `desktop/package.json`,
  `desktop/scripts/test-backend-bridge.mjs`,
  `desktop/scripts/test-native-layout.mjs`,
  `desktop/scripts/test-editor-extension.mjs`,
  `desktop/scripts/test-editor-runtime.mjs`,
  `desktop/scripts/test-workspace-performance.mjs`,
  `desktop/tests/workspace-performance.html`,
  `desktop/tests/workspace-performance.tsx`, and this report.

Other existing working-tree changes are outside this optimization and remain intact.

## Follow-up: remaining desktop lag

A process audit found five orphaned bundled code-server roots (29 processes
including descendants) while ContextGit itself was closed. Available RAM was
roughly 1.0–1.2 GB on a 7.2 GB machine, with about 6.6 GB swapped out. With explicit
user approval, only those verified trees were terminated; no project files,
settings or sessions were deleted. A subsequent audit found no remaining editor
trees, about 1.5 GB available RAM and roughly 1.5 GB more free swap. These are
system snapshots, not controlled application-performance benchmarks.

Additional fixes:

- Backend health probing now runs off Tauri's UI thread, including its socket
  timeouts. Renderer health refreshes share one in-flight request, and unchanged
  status no longer notifies every subscriber and rerenders the shell.
- Linux editor launchers receive a parent-death SIGTERM even on desktop crash or
  Ctrl+C. A dedicated parked launcher thread owns this lifetime; an expiring
  async worker cannot accidentally terminate an active editor. Normal shutdown
  still disposes the owned process group. Other platforms retain normal explicit
  process cleanup; the Linux crash guard does not claim Windows crash coverage.
- Each editor instance writes its own safety ledger; older servers cannot
  overwrite the new instance's clean/dirty report. Clean layout restoration
  retains its stable existing file, preserving prior layouts.
- Limits countdown rendering runs every 30 seconds instead of every second and
  stops when Code is inactive or the application is hidden.

Files changed in this follow-up: `desktop/src-tauri/src/main.rs`,
`desktop/src-tauri/editor-extension/extension.cjs`, `desktop/src/tauri-bridge.ts`,
`desktop/src/shell/terminal/HarnessLimitsPanel.tsx`,
`desktop/scripts/test-backend-bridge.mjs`,
`desktop/scripts/test-editor-extension.mjs`,
`desktop/scripts/test-editor-runtime.mjs`, and this report. Temporary diagnostic
and narrowly scoped shutdown scripts are under `/tmp/contextgit-process-audit.cjs`
and `/tmp/contextgit-stop-orphan-editors.cjs`, outside the application source.

Follow-up validation: TypeScript, renderer build, editor/browser Node checks,
workspace lifecycle harness, cargo check and all seven Rust tests pass. The
workspace harness again records 20 warm round trips with no additional servers
or views and no stationary bounds calls. Independent backend tests pass (24).
Desktop/docs whitespace checks pass; repository-wide checks still flag the
preserved unrelated whitespace in `tests/conftest.py`.
The real code-server runtime check also passes with separate instance ledgers
and the shared restore file (7,332 ms cold workbench, 1,054 ms dirty transition
including browser automation). It verifies saved-file restoration after restart;
it does not measure native WebKit typing latency.

Historical source note: the optimization pass above used the root `main`
working tree, not `add_vscodeandbrowser`, before incorporating the 12 newer
commits on `origin/main`. The integration validation below supersedes that
earlier branch state and the fixture/whitespace limitation noted above.

The general-browser follow-up also changes `desktop/shared/browser.ts`,
`desktop/scripts/test-browser-address.mjs`, `desktop/src/shell.css`, and the
workspace/native lifecycle files and test harness listed above. Native website
load events are configured in Rust rather than granting remote sites access to
the application bridge. Renderer CSP and remote capability restrictions remain
unchanged.

## Integration validation after resolving the rebase

Resolved overlapping changes against `origin/main` at `69834a6`, preserving the
upstream session/agent behavior and the native editor/browser implementation.
The working-folder selector now uses icon tabs; the app chrome has square
corners. Terminal opens a plain project-root shell directly. The command palette
supports click, Ctrl+K/Command+K in the renderer, searching commands/projects/
sessions, keyboard navigation, command errors and focus restoration.

The shared Python fixture's undefined variable was corrected to its original
`author="tester"` argument. Django's bind address is added after command parsing
so quoted `manage.py` commands work without appending a second address.

Validation: TypeScript typecheck, renderer build, editor/browser Node checks,
all seven Rust tests, the workspace lifecycle harness, and dark/light selector
and command-palette UI checks pass. The selected backend suites passed 106 tests;
both additional focused Django launcher regression cases also pass. The real
code-server runtime check passes startup, dirty/save reporting and saved-file
restoration using separate lifecycle ledgers. Repository-wide
`git diff --check` passes after the fixture correction. Tests and report are
grouped separately from native runtime, lifecycle/performance, and shell UI
changes for review; local `.shiki` tool state is not part of the published work.
