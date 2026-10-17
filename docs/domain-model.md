# Domain model and status mapping

Canonical roadmap: [`PHASES.md`](../PHASES.md). This document covers
terminology, relationships, and status projections. It is canonical for those
topics. Older docs that disagree with it are superseded.

## Terms

| Term | Meaning | Code |
|---|---|---|
| Project | A ContextGit repository | `core/repo.py` |
| Task | One unit of agent work, primary orchestration unit | `core/models.py::Task`, `core/lifecycle.py` |
| Team | A coordination view over Tasks (board, merge queue) | `core/team.py` |
| Session | A conversation with an agent, tied to a branch and worktree | `core/models.py::Session` |
| AgentRun | One agent execution with its own lifecycle and steps | `core/models.py::AgentRun` |
| Worktree | Git checkout that holds a Task's code | `gitops/worktree.py` |
| AgentEvent | Provider-neutral event envelope | `core/events.py` |
| Adapter | Provider capability declaration | `adapters/base.py`, `adapters/registry.py` |

## Relationships

- A Team owns Tasks. A Task is shown on the Team board but does not depend on a Team.
- A Task may link to one Session and one AgentRun, and to one branch and worktree.
- A Session may exist without a Task (legacy sessions remain valid).
- An AgentRun belongs to a Session when one exists.
- Dependencies (`depends_on`, `blocked_by`) are derived from `task_deps`.
  `blocked_by` is never stored.

## Canonical Task phases

`DRAFT`, `READY`, `RUNNING`, `IMPLEMENTED`, `VERIFYING`, `READY_TO_MERGE`,
`BLOCKED`, `FAILED`, `CANCELLED`. The allowed moves are in
`contextgit/core/lifecycle.py::TRANSITIONS`. Invalid moves raise
`InvalidTaskTransition`.

`IMPLEMENTED → READY_TO_MERGE` is a deliberate shortcut. It keeps today's
human-approve flow working. Phase 5 replaces it with evidence-based gates.

## Status projections

Storage keeps the legacy values. `phase` is derived from them and never stored.

### Team task status → canonical phase

`Task.phase` is a computed field. `blocked` means unfinished dependencies exist.
`verifying` means a verifier run is attached to the task.

| Legacy `TaskStatus` | Canonical phase |
|---|---|
| `todo` (no unfinished deps) | `READY` |
| `todo` (unfinished deps) | `BLOCKED` |
| `blocked` | `BLOCKED` |
| `working` | `RUNNING` |
| `review` (no verifier) | `IMPLEMENTED` |
| `review` (verifier attached) | `VERIFYING` |
| `done` | `READY_TO_MERGE` |
| `failed` | `FAILED` |

### Reverse projection (phase → legacy, used when writing)

Lossy by design:

| Phase | Legacy |
|---|---|
| `DRAFT`, `READY` | `todo` |
| `BLOCKED` | `blocked` |
| `RUNNING` | `working` |
| `IMPLEMENTED`, `VERIFYING` | `review` |
| `READY_TO_MERGE` | `done` |
| `FAILED`, `CANCELLED` | `failed` (no legacy cancelled value) |

### AgentRun status → phase

| AgentRunStatus | Phase |
|---|---|
| `queued` | `READY` |
| `inspecting`, `planning`, `awaiting_approval`, `executing` | `RUNNING` |
| `validating` | `VERIFYING` |
| `ready`, `completed` | `IMPLEMENTED` |
| `failed` | `FAILED` |
| `cancelled` | `CANCELLED` |

### Session status → phase

| SessionStatus | Phase |
|---|---|
| `idle` | `READY` |
| `running` | `RUNNING` |
| `done` | `IMPLEMENTED` |
| `error` | `FAILED` |

## Enforcement status

- Canonical transitions are enforced for new canonical operations only.
- Existing Team operations keep their legacy behavior. `approve_task` still
  accepts `todo → done`, and `reject_task` still sends any non-done task to
  `working`. Tightening these paths would break current workflows, so it is a
  separate decision.

## Event envelope

Fields: `id`, `aggregate_id`, `event_type`, `timestamp`, `source`,
`payload_version`, `correlation_id`, plus optional `task_id`, `session_id`,
`run_id`, `capture`, `data_label`, and `payload`.

- `event_type` ∈ lifecycle, message, tool_call, command, file, usage, model, status, error.
- `capture` ∈ FULL, PARTIAL, ESTIMATED, UNAVAILABLE.
- `data_label` ∈ reported, observed, estimated. Token counts must carry a label.
- Naming: lowercase snake_case event types. Payload shape changes bump `payload_version`.

## Service-boundary conventions

- Domain rules live in pure modules (`core/lifecycle.py`) with no storage or git imports.
- Provider-specific behavior lives in `adapters/`. Core code reads capability flags only.
- `Repo` and `api/app.py` are compatibility entry points. New logic goes into
  focused modules, not into them.

## Deprecation policy

- Roadmap and data-model documents that disagree with `PHASES.md` are marked
  superseded with a link to it. Their content is not deleted.
- Historical knowledge and sessions are never silently deleted. They are marked
  stale or superseded.
- Storage changes are additive migrations only. Legacy status values keep working.

## Identifiers (Phase 0 scope)

Project, Task, AgentRun, Session, Worktree, Commit, ContextSnapshot, Memory,
VerificationRun, Review, Merge. Identifiers are existing ids. Phase 0 does not
change their format.

## Security audit

Phase 0 requires revalidating `docs/codebase-audit.md`. That has **not** been
done yet. Tracked as remaining Phase 0 work.
