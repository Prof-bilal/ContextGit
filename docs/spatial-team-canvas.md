# Spatial team canvas

The desktop opens directly into the graphite/orange project canvas. The legacy
Git, editor and browser implementations are retained for migration, but Shell
does not import or mount their surfaces. Old feature URLs open the canvas.

## Use

### Parent-led teams with live terminals

Choose **Create team** in the existing canvas toolbar. Select an installed Codex
or Claude parent, allowed worker CLIs, the goal, a maximum active worker count,
and optional approved skills. The parent starts in its own worktree with the
full orchestration instructions. It chooses the number of workers and proposes
a plan through MCP; it does not receive a fixed worker count.

The existing team container shows the parent's interactive terminal above the
workers' interactive terminals. Purple skill trees show the instruction
snapshots attached to each session. There are no team progress-bar cards.
The team header provides plan review, approval-gated worker additions,
pause/resume, final merge review, collapse, and archive controls.

Approve the plan to authorize worker processes. Only approved workers launch;
dependencies must be integrated before their worktrees are created, and each
new worker starts from the current team integration commit. Parent approval of
a completed worker re-runs its project checks and integrates into the isolated
`codex/team/<team-id>` branch through a serialized, checked candidate worktree.
No automatic integration into the user's target branch or remote push occurs.
Automatic integration requires a detected/configured project quality gate.
Failures retain the worker and candidate worktrees and post the error to the
team board. The parent can request correction or retry with `integrate_team`.

New plan revisions may append workers after user approval; existing approved
worker instructions and dependencies remain immutable in this first release.
The parent reads actual task IDs from `list_tasks` when proposing additions.
Team pause prevents scheduling and integration; active CLIs continue. Reopening
the app does not restart agents automatically: use the parent terminal's
resume control or the team's pause/resume controls to resume coordination.
Collapsing or expanding terminals never kills or duplicates their processes.

Final merge confirmation rechecks reviewed work, the integration head, clean
worktrees, and combined tests. It fast-forwards the original target branch only
when that branch is checked out and has not diverged. Diverged targets require
an explicit update and validation rather than an automatic merge. Existing
teams created before this opt-in execution mode retain the legacy workflow
described below. Migration 0031 adds durable team execution settings and
integration results without replacing existing team or session records.

Run `npm run test:live-team --prefix desktop` for the real canvas/PTY wiring
fixture (requires root Playwright dependencies and system Chromium), and
`pytest tests/test_parent_execution.py` for real-Git integration regressions.

1. Choose a project from the floating selector. Right-click the canvas or use
   **New team** to place a bounded team. Select the parent CLI, optional role
   skills and a goal.
2. The parent submits a structured plan through MCP. Review worker CLIs, roles,
   instructions, scopes, dependencies, completion criteria and skill IDs before
   choosing **Approve and launch**. There are at most 12 workers per team.
3. Drag the team header to move the whole team. Resize its boundary, collapse it,
   or drag workers to reorder them inside the boundary. Click a worker or its
   orchestrator to open the interactive terminal. Closing this view only closes
   xterm; process ownership and transcript recording remain in TerminalRuntime.
4. Use the bottom command target to address the parent or an individual worker.
   Pause stops scheduling future work; active CLIs continue. Resume launches
   eligible work. Workers test and commit their changes, then submit them for
   review. The parent can approve reviews through MCP.
5. **Review merge** shows completed work and changed files. The server checks
   gates, conflicts and uncommitted implementation files again when the user
   explicitly confirms. Spatial teams bypass the old automatic integration
   path. MCP cannot confirm a final merge.
6. Review proposed skills in the floating Skills library. Approve, reject,
   remove, assign a snapshot to a team/worker, or promote an approved project
   skill to the global library. Instructions assigned to existing work remain
   snapshots after later library changes.

Shift-click worker cards to select them for grouping. Group stopped/unstarted
workers together with their dependencies; active workers must finish or stop
before changing execution teams. Existing sessions are imported into bounded
**Ungrouped runs** groups without recreating their sessions or worktrees.
Grouping preserves session identities; **Run team** starts the approved group.
Presets save a reusable plan and load it into a new draft for review.

Project viewport, team geometry, collapse state and layering are persisted.
Files, Skills and Presets panel visibility follows each project. Use **Files**
to search the project and open movable read-only text, Markdown, image or diff
cards. The file icon on a team opens its linked orchestration job document at
`.contextgit/teams/<team-id>/job.json`.

## Local voice

The microphone opens local voice controls. Download the multilingual base model
on first use, hold the recording button (or Space), then release to transcribe.
Review/edit the transcript and choose **Use reviewed transcript** to put it in
the command bar. Sending remains a separate user action.

Whisper runs in a bundled `whisper.cpp` v1.7.6 CLI. Microphone audio becomes mono
16 kHz PCM WAV, is passed directly to the desktop command, and is removed after
local transcription. There is no transcription HTTP endpoint. Network access
is limited to the official model download. Its expected SHA-256 is
`60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe`.
The model is stored under the application data `voice` directory, not bundled
with the installer. Download progress, retry, cancellation, checksum rejection,
silence detection, microphone-denial errors, transcription cancellation and
model removal are exposed in the panel.

macOS packaging includes microphone usage text and the audio input entitlement.
The native permission handler grants microphone requests only to the local app
windows, not embedded websites. Actual access still depends on OS permission.

## Storage and compatibility

Migration 0030 adds the team state/parent identity, plan revisions, team layouts,
project viewports and skill snapshots. Existing data is retained. Team-scoped
routes under `/api/v1/teams/{id}` are used by the canvas. Legacy singular-team
routes and standalone-task APIs remain available.

Project skills are stored under `.contextgit/knowledge/skills`. Global skills
are stored in the desktop application-data `skills` directory. Approved skills
have `SKILL.md` documents; all actions retain registry revision records. Removal
deactivates a skill and archives the active document rather than erasing its
history. Approved legacy lessons are imported once using their lesson IDs.

The packaged backend also supports `--mcp`, so installed desktop builds do not
depend on a separately installed `contextgit-mcp` executable. Claude and Codex
project MCP configurations are generated when starting the parent/workers.

## Build and verify

Install Python development dependencies and the root/desktop npm dependencies.
The voice build needs Git, a C/C++ toolchain and CMake; the build script also
finds CMake installed in the repository virtual environment.

```sh
.venv/bin/python -m pytest -q
.venv/bin/ruff check contextgit tests
.venv/bin/mypy contextgit
npm run typecheck --prefix desktop
npm run test:spatial-runtime --prefix desktop
npm run test:spatial-canvas --prefix desktop
npm run build:voice --prefix desktop
npm run build:renderer --prefix desktop
npm run build:backend --prefix desktop
cargo check --manifest-path desktop/src-tauri/Cargo.toml
cargo test --manifest-path desktop/src-tauri/Cargo.toml voice::tests
```

The browser check verifies two teams with twelve workers each, real pointer
interaction, streaming output, terminal mount/unmount, collapse, project
switching, skill assignment, read-only files and denied microphone permission.
It writes a screenshot to `/tmp/contextgit-spatial-canvas.png`.
The runtime check verifies process identity, detached views, transcript
persistence and explicit command routing. Backend integration tests exercise
goal → proposal → approval → worker dependencies → review → explicit merge →
approved global skill, alongside migration, permission and snapshot regressions.

Automated checks use mocked CLIs for the 24-agent renderer stress case; they do
not incur paid model usage. Real local Whisper transcription is checked against
the upstream sample recording. Interactive CLI authentication, actual microphone
hardware and Windows/macOS runtime behavior require testing on those machines.
