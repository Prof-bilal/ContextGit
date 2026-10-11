# Reliability refactor: implementation status

This is the first verified phase of the approved refactor, not completion of the
whole plan. Existing data and historical migrations remain intact.

## Implemented

- OpenCode launch-scoped native conversation binding, persisted in SQLite and
  retained across restart/resume. No timestamp or terminal-prompt guessing.
- Explicit recovery selection for pre-existing unbound terminals. Choose the
  correct native conversation using **Stage conversation → Link and stage** in
  Code, then create a new checkpoint. Old commits are never rewritten or given
  another session's transcript.
- Actual prompt/reply capture, native message receipts, duplicate-safe retries,
  and specific unbound/missing/unsupported/incomplete/interrupted states.
- Direct OpenCode checkpoints capture the transcript before committing, without
  needing a terminal screenshot. Incomplete or interrupted replies are refused.
- Atomic checkpoints and nested SQLite transactions; failed migrations roll
  back schema changes and their version receipt together.
- Bounded, indexed commit-conversation pages. Git renders message text only and
  supports cancellation, local errors, retry, and loading additional pages.
- Git deletion moves sessions/history to recoverable Storage. Closing a terminal
  retains its session and staged history. Permanent deletion remains separate.
- All-project/project history no longer silently resets its selection to main.
- Correct launch working directory for OpenCode and authenticated CORS access
  for the built desktop renderer.
- Event-driven repository reloads with stale-response protection. The retired
  Issues scheduler is no longer started with the backend.
- Extracted transcript routes/service/store, shared SQLite connection layer,
  Electron conversation instrumentation, and transcript styles.
- Clean backend Ruff/mypy checks and CI gates for Python plus retained desktop
  builds, lifecycle/Markdown tests, and focused Code/Git end-to-end tests.

## Verified locally on Linux

- Python regression suite, Ruff, and mypy.
- Renderer typecheck/build and Electron build.
- Lifecycle and Markdown tests.
- Focused desktop tests: two tabs, keyboard navigation, legacy URL redirects,
  message-only conversation, recoverable deletion/restore, backend restart,
  and six simultaneous real shell terminals with tab switching and staging.
- 10,000-message checkpoint pagination: bounded pages, exact ordering, no loss.
- Live OpenCode 1.18.33 with a real `opencode/mimo-v2.6-flash-free` response:
  checkpoint, repeated ingestion, process restart, and same-ID resume. This
  does not establish verification of Agnes or other configured providers.

Live verification is reproducible with `npm run test:opencode:live --prefix
desktop`. Override `OPENCODE_BINARY` or `OPENCODE_TEST_MODEL` when needed. The
script uses a private temporary project and does not delete native/user history.

Run the longer six-terminal gate with:

```sh
CONTEXTGIT_SOAK=1 npx playwright test e2e/reliability.spec.ts --workers=1
```

The default desktop run exercises the terminals briefly; it is not a 30-minute
soak result. CI fixtures are explicitly not live-provider verification.

## Still pending; full release is not validated

- Structured capture and exact launch/resume binding for Claude Code, Codex,
  Gemini, Aider, Ollama, Freebuff, Cline, Pi, Kilo, and Command Code.
- Complete removal of retired feature routes, commands, IPC, modules, tests,
  and dependencies across frontend/backend/CLI/MCP. The sources and APIs still
  exist; only public navigation and the Issues startup scheduler are disabled.
- Remaining repository/storage/Electron/frontend decomposition and CSS split.
- Project/session-history pagination, incremental native-read cursors, long-list
  virtualization, full polling consolidation, and measured performance baselines.
- Full 30-minute soak, project-switch stress, comprehensive retained feature
  isolation tests, and the legacy desktop suite's retirement/update.
- Windows/macOS live validation, remaining harness/provider validation, and
  broader project-memory conflict/isolation audit.

CI additions have been checked locally through their component commands; the
GitHub workflow itself has not been run remotely. No push/deployment is included.
