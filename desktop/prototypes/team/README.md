# Team Mode browser prototype

This is the first, reviewable delivery of the Team Mode plan. It is a local browser sandbox, separate from the Tauri app. It never calls the production API, starts a CLI, modifies a worktree, merges a Git branch, or pushes to a remote. All activity, checks, commits, and installation statuses are simulated and explicitly labeled in the UI.

From `desktop/`:

```sh
npm run prototype:team
# http://127.0.0.1:5174/
npm run prototype:team:check
npm run prototype:team:build
# With the dev server running and system Chromium available:
npm run prototype:team:ui
```

`prototype:team:ui` uses Node 24's built-in WebSocket and `/usr/bin/chromium`; override `CHROMIUM_BIN` or `TEAM_PROTOTYPE_URL` when needed. It launches an isolated temporary Chromium profile, exercises the real pointer targets, and saves screenshots under `/tmp/contextgit-team-*.png`. The build output is `desktop/dist-team-prototype/`.

## Review flow

1. Create a team, select the parent and permitted worker CLIs, choose skills, and describe the task.
2. Let Auto-play advance the parent's exploration, or turn it off and use Next step.
3. Review the proposed workers. Edit ownership, dependencies, CLI, criteria, and skills. Invalid plans cannot launch. Requesting a revision preserves edits and incorporates the feedback into the simulated rationale.
4. Approve and launch. Inspect agent cards for instructions, simulated terminals, and review history. Drag the team header to move the group; use the canvas controls to zoom and fit.
5. Watch the parent review and serialize integration. The QA worker waits for its prerequisites' integration commits. Pause freezes demo progress and prevents scheduling and integration; real active terminals would remain running.
6. Review the combined simulated diff, then explicitly confirm a simulated merge into main. This never invokes Git.

The scenario selector covers normal completion, added-worker approval, missing CLI, worker correction, integration conflict, and combined-check failure. Changing scenarios asks before replacing the saved demo. Team state and immutable instruction snapshots are saved under the browser-local key `contextgit:team-prototype:v1` and restored after reload. Demo playback preference, transient dialogs, selection, and canvas geometry are not persisted.

## Adapter and production boundary

`model.ts` exports the `TeamAdapter` contract (`getSnapshot`, `subscribe`, `dispatch`, `reset`), serializable state/types, validation, and the pure state transition function. `ui.tsx` consumes that contract using React's external-store subscription. The mock adapter makes no network requests. Parent planning and execution are deterministic demonstrations, not an LLM integration.

The prototype supports adding approved workers during execution. Existing scope/skill edits are locked after launch. Approval-gated changes to an existing live worker's scope or dependencies remain part of the production phase, which must preserve immutable approved revisions and active worktrees.

Following UI review, production work still needs:

- Additive team storage fields for concurrency, integration branch/head/status, rationale, approvals, and integration history.
- Parent startup instructions supplied before PTY creation, with a dedicated parent worktree.
- Server-validated plan amendments and real dependency-aware scheduling/worktree bases.
- Parent-scoped MCP integration authority limited to `codex/team/<team-id>`, serialized integration, real clean-tree checks and quality gates, conflict recovery, and durable idempotency.
- Existing user-controlled final merge into main, with no automatic remote push.

Those production operations are intentionally not wired before the UI review specified in the accepted plan. Existing desktop APIs, sessions, and standalone runs remain unchanged by this prototype.
