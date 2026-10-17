# ContextGit Roadmap: Local Control Plane for AI-Generated Software

**Canonical roadmap.** This file supersedes earlier roadmap documents. Where
`docs/*.md` disagrees with this file, this file wins.

## Summary

ContextGit already has Git branches and worktrees, sessions, task/team
workflows, agent runs, usage tracking, verification gates, knowledge capture,
project memory, merge queues, MCP tools, and a Tauri desktop app.

The roadmap extends these systems incrementally into a local-first system of
record for agents, tasks, context, decisions, evidence, provenance,
verification, and merges. Existing Team/Task, Session, AgentRun, worktree,
claims, verification, knowledge, and merge systems are unified, not replaced.

Differentiators:

1. Context Compiler
2. Context Graph
3. Agent Task Graph
4. Agent Flight Recorder
5. Evidence-Based Merge Gates
6. Portable Project Memory
7. Optional Runtime Isolation

## Product principles

- Git remains the source of truth for code.
- ContextGit is the source of truth for agent work, context, decisions, evidence, and reasoning.
- Existing workflows remain compatible.
- Deterministic logic precedes LLM behavior.
- Provider-specific logic stays inside adapters.
- Local-first operation remains possible without cloud infrastructure.
- Humans retain final merge authority.
- Historical knowledge is superseded or marked stale, never silently deleted.
- Token counts are labeled as exact, provider-reported, or estimated.
- No vector database until deterministic retrieval is proven insufficient.

## Repository audit (condensed)

| Capability | Status | Key code | Remaining work |
|---|---|---|---|
| Git repo, branches, worktrees | COMPLETE | `core/repo.py`, `gitops/` | Link worktree lifecycle to Tasks |
| Sessions | COMPLETE | `core/models.py`, `storage/sqlite.py` | Relate sessions to Tasks and AgentRuns |
| Terminal transcripts | PARTIAL | `integration/capture.py`, `transcript.py` | Provider-neutral event capture |
| Agent adapters | EXPERIMENTAL | `integration/runners.py` | One interface across providers |
| Agent runs | PARTIAL | `core/models.py`, `agent/service.py` | Connect to events, Tasks, provenance |
| Team/task DAG | PARTIAL | `core/team.py` | Promote Task to primary orchestration model |
| Task scope/ownership | PARTIAL | Task `scope`, session claims | Explicit read/write/shared/blocked claims |
| Task status | PARTIAL | `TaskStatus`, `AgentRunStatus`, team statuses | Canonical lifecycle and mappings |
| Project memory | PARTIAL | `memory/project.py`, `memory/bundle.py` | Context Graph and provenance |
| Knowledge and skills | PARTIAL | `knowledge/*` | `.contextgit/skills/` as canonical source |
| Context token estimation | PARTIAL | `llm/context_window.py` | Quality categories, confidence |
| Context compilation | EXPERIMENTAL | `core/repo.py`, managed AGENTS context | Deterministic Context Compiler V1 |
| Semantic merge | COMPLETE | `merge/semantic.py` | Evidence source, not autonomous authority |
| Merge readiness | PARTIAL | Team gate fields, merge queue | `IMPLEMENTED` and `READY_TO_MERGE` states |
| Provenance | PARTIAL | why/history endpoints, TeamEvents | Compact event ledger, code-to-task trace |
| Runtime isolation | PARTIAL | `run_env` migration, ports, worktrees | Local environment allocation and cleanup |
| Replay | EXPERIMENTAL | bisect/replay endpoints | Reproducible task environment semantics |
| CLI | PARTIAL | `cli/main.py` | task/context/verify/review/trace commands |
| Desktop UI | PARTIAL | `desktop/src/shell`, `desktop/shared/api.ts` | Task-centric control plane views |
| Backend API | PARTIAL | `api/app.py` | Service boundaries without a rewrite |
| Storage | COMPLETE | SQLite migrations through `0027_session_models.sql` | Event/context/graph tables, additively |
| MCP | PARTIAL | `mcp/*` | Expose context compilation and provenance safely |
| Tests | PARTIAL | Python, desktop, browser, Git/worktree | Cross-subsystem lifecycle and compiler tests |
| CI | COMPLETE | `.github/workflows/python-app.yml` | Integration/e2e coverage, security checks |
| Security boundary | SHOULD REFACTOR | API server, subprocess, provider storage, desktop bridge | Revalidate historical audit findings |
| Documentation | SHOULD REFACTOR | `docs/*.md` | This file canonical; update stale docs |
| Duplicate domain concepts | SHOULD REFACTOR | Session, AgentRun, Task, Team, Knowledge | Canonical relationships, see `docs/domain-model.md` |
| Generic IDE scope | KILL / DEFER | Editor and browser features | Keep integrations supporting only |

## Phase 0 — Audit and architecture stabilization

**Objective:** a reliable foundation for extending the existing systems without
duplicating Task, Session, AgentRun, memory, or verification concepts.

**Depends on:** none. **Priority:** MUST. **Complexity:** L.

Work:
- Canonical domain terminology and relationship map (`docs/domain-model.md`).
- Compatibility mapping between Session, AgentRun, Team, and Task statuses.
- Event envelope fields: event ID, aggregate ID, event type, timestamp, source,
  payload version, correlation ID (`contextgit/core/events.py`).
- Revalidate historical security findings from `docs/codebase-audit.md`: local
  API auth, CORS, shell execution, SSRF, provider-secret handling, desktop
  navigation, CSP.
- Canonical identifiers for Project, Task, AgentRun, Session, Worktree, Commit,
  ContextSnapshot, Memory, VerificationRun, Review, Merge.
- Extract services from `Repo` and `api/app.py` only where the boundary is clear.
- Tauri bridge and typed API boundary documented; duplicate desktop state identified.
- "reported", "observed", and "estimated" data labels.

Definition of Done:
- [ ] One documented canonical domain model exists.
- [ ] Session, AgentRun, Team, and Task responsibilities are mapped.
- [ ] Existing workflows pass unchanged.
- [ ] Historical audit findings are marked verified, fixed, or deferred.
- [ ] New code has a defined service boundary.
- [ ] `PHASES.md` is canonical and older roadmap documents are marked superseded.
- [ ] No rewrite is required.

Explicitly not included: full orchestration, new providers, vector search,
cloud sync, UI redesign.

## Phase 1 — Task and agent foundation

**Objective:** make Task the primary unit of agent work while preserving existing
sessions and AgentRuns.

**Depends on:** Phase 0. **Priority:** MUST. **Complexity:** XL.

Canonical Task lifecycle:

```
DRAFT → READY → RUNNING → IMPLEMENTED → VERIFYING → READY_TO_MERGE
                   ↘ BLOCKED   ↘ FAILED   ↘ CANCELLED
```

Team statuses stay as compatibility projections. The implementation is in
`contextgit/core/lifecycle.py`.

Work:
- `AgentAdapter` contract (`contextgit/adapters/base.py`) and capability
  registry (`contextgit/adapters/registry.py`) for codex, claude, opencode, terminal.
- Normalized `AgentEvent` envelope (`contextgit/core/events.py`).
- `TaskService`, and a Task-to-Session and Task-to-AgentRun relationship service.
- Task detail view; unsupported adapter capabilities shown clearly.
- CLI: `contextgit task create | list | show <id> | start <id> --agent <a> | stop <id>`,
  with existing `ctx` aliases retained where applicable.
- Additive data: task metadata, parent/dependency links, task↔session and
  task↔run links, capability metadata, append-only event storage.

Definition of Done:
- [ ] A Task can be created and displayed independently of a Team.
- [ ] A Task links to one active worktree and branch.
- [ ] A Task links to a Session and AgentRun.
- [ ] Codex, Claude, OpenCode, and terminal declare adapter capabilities.
- [ ] Existing sessions still open and run.
- [ ] Agent events use a provider-neutral envelope.
- [ ] Invalid lifecycle transitions are rejected deterministically.

Explicitly not included: automatic decomposition, autonomous scheduling,
reviewer agents, runtime database isolation, cost dashboards.

## Phase 2 — Coordination and scope ownership

**Objective:** make dependencies and file ownership explicit enough to coordinate
parallel agents safely.

**Depends on:** Phase 1. **Priority:** MUST. **Complexity:** L.

- `ScopeClaim` with `write`, `shared`, `read`, `blocked` patterns.
- Deterministic checks: overlapping exclusive writes, shared-file conflicts,
  blocked paths, duplicate scopes, architecture-sensitive paths, dependency
  cycles, task readiness. Explanations record which pattern matched.
- Convert existing `scope` strings to a default `write` claim only when unambiguous.
- CLI: `contextgit task graph`, `claims show`, `claims conflicts`, `task ready <id>`.

Definition of Done:
- [ ] Dependency cycles cannot be persisted.
- [ ] Two exclusive claims on one path produce a deterministic conflict.
- [ ] Read-only overlap does not create a write conflict.
- [ ] Existing Team board behavior remains functional.
- [ ] Readiness explains every blocker.
- [ ] Worktree creation includes the task's scope metadata.

## Phase 3 — Context Graph and Context Compiler V1

**Objective:** replace flat context accumulation with structured, traceable
knowledge, and compile only relevant context per task.

**Depends on:** Phases 1 and 2. **Priority:** MUST. **Complexity:** XL.

- Node categories: architecture, decisions, conventions, constraints, failed
  experiments, known bugs, dependencies, APIs, schemas, skills, historical context.
- Each node stores source (session/task/commit), created and last-confirmed
  timestamps, confidence, status, tags, affected paths, provenance references.
- Statuses: `ACTIVE`, `STALE`, `CONFLICTING`, `SUPERSEDED`, `UNVERIFIED`.
- Retrieval order: task metadata → affected paths → dependency/scope relations →
  active decisions and constraints → recent related commits → approved skills →
  relevant prior failures → explicit user-selected context.
- Stale material is excluded by default. The compiler persists a manifest of
  selected and excluded items with reasons.
- CLI: `context inspect|compile|explain <task-id>`, `memory list`, `memory mark-stale <id>`.

Definition of Done:
- [ ] Compiler V1 produces a reproducible manifest.
- [ ] Retrieval is deterministic only.
- [ ] Every included item has a source and reason.
- [ ] Stale items are excluded by default.
- [ ] Existing project memory and knowledge can be imported.
- [ ] Context size is shown and labeled estimated where necessary.
- [ ] Full conversation history is not needed for normal task startup.

Explicitly not included: embeddings, vector databases, autonomous memory deletion,
automatic LLM decision extraction, semantic search as the primary retrieval.

## Phase 4 — Agent Flight Recorder and provenance

**Objective:** durable, compact provenance linking code changes to tasks, agents,
prompts, context, tools, verification, and commits.

**Depends on:** Phases 1 and 3. **Priority:** MUST. **Complexity:** L.

- Append-only `FlightEvent` ledger. Large payloads are stored by content hash.
- Capture quality labels: `FULL`, `PARTIAL`, `ESTIMATED`, `UNAVAILABLE`.
- Provenance graph service, event compaction policy, task timeline, and a
  code-to-task trace resolver.
- CLI: `trace <task-id>`, `trace commit <commit>`, `trace file <path>`.

Definition of Done:
- [ ] A task timeline can be rebuilt from stored events.
- [ ] A commit can be traced to a Task when ContextGit initiated the work.
- [ ] Partial capture is labeled.
- [ ] Large payloads are not duplicated unnecessarily.
- [ ] Existing transcripts and usage data remain readable.

Explicitly not included: exact replay, hidden system prompt capture, provider
reverse engineering, cloud telemetry.

## Phase 5 — Review intelligence and evidence-based merge gates

**Objective:** make IMPLEMENTED → READY_TO_MERGE an evidence-based transition.

**Depends on:** Phases 1, 2, and 4. **Priority:** MUST. **Complexity:** L.

- `merge_requirements` per task (tests, lint, typecheck, security for auth,
  permissions, payments).
- Evidence collected: changed files, sensitive paths, migrations, API changes,
  test/lint/typecheck results, scope violations, unresolved conflicts, review status.
- Deterministic readiness rules. LLM review may summarize evidence but cannot
  override gates.
- CLI: `verify <id>`, `review <id>`, `merge-status <id>`, `merge <id>`. `merge`
  requires human approval.

Definition of Done:
- [ ] A task can be IMPLEMENTED without being READY_TO_MERGE.
- [ ] Required checks are deterministic and explainable.
- [ ] Sensitive changes require configured review evidence.
- [ ] Human approval is required for merge.
- [ ] Existing merge queue and semantic merge behavior remain functional.

Explicitly not included: autonomous merge, a generic noisy AI reviewer,
reviewer loops, organization-wide policy.

## Phase 6 — Runtime isolation (SHOULD)

**Objective:** extend worktree isolation to local runtime state.

**Depends on:** Phases 1 and 2. **Complexity:** L.

- Task-scoped ports, env vars, Compose project names, database names, Redis
  namespaces, queues, volumes, temp dirs. Environments recorded in provenance.
- CLI: `env create|show|destroy <task-id>`.
- Cleanup is idempotent. Secrets are never stored in plain event payloads.

Definition of Done: isolated environment per task; allocated resources visible
and recoverable; cleanup idempotent; no Kubernetes dependency; non-isolated
sessions unaffected.

## Phase 7 — Portable skill and memory intelligence (SHOULD)

**Objective:** make ContextGit the canonical owner of project skills, and export
provider-specific projections.

**Depends on:** Phases 3 and 4. **Complexity:** L.

- Canonical `.contextgit/skills/`. Exports for `AGENTS.md`, `CLAUDE.md`, Cursor
  rules, `SKILL.md`.
- Lifecycle: `PROPOSED → APPROVED → ACTIVE → STALE → SUPERSEDED`. Historical
  skills are never silently deleted.
- CLI: `skill list|inspect|approve|export --provider|supersede`.

Definition of Done: `.contextgit/skills/` is canonical; provider files are
generated projections; skills keep evidence links; stale knowledge is marked,
not deleted; existing knowledge workflows keep working.

## Phase 8 — Reviewer agents and reproducible environments (LATER)

**Depends on:** Phases 1–6. **Complexity:** XL.

- Reviewer adapter role and bounded review protocol (fixed iteration limits).
- Structured reviewer output: requirement compliance, missing tests, scope and
  architecture violations, security-sensitive changes, regression risk.
- Replay manifests (repository revision, Task, context package, instructions,
  environment, tool permissions). Called a reproducible task environment, not
  deterministic model replay.
- CLI: `review --agent <a> <id>`, `replay <id>`, `schedule explain <id>`.

Definition of Done: reviewers cannot merge; loops have fixed limits; replay
labels model nondeterminism; human approval stays authoritative.

## Phase 9 — Cost, token, and agent-performance analytics (LATER)

**Depends on:** Phases 1, 4, 5. **Complexity:** M.

- Metrics: cost per merged task, tokens per successful task, merge rate by
  model, review time by model, retry rate, verification failure rate, context
  reduction versus full history.
- Metrics distinguish exact and estimated values. Unlinked historical usage stays
  visible but marked.
- CLI: `metrics task <id>`, `metrics project`, `usage export`.

Definition of Done: exact vs estimated distinguished; cost per merged task where
data exists; analytics never affect execution or merge authority.

## Priority classification

- **MUST:** Phases 0, 1, 2, 3, 4, 5.
- **SHOULD:** Phases 6, 7.
- **LATER:** Phases 8, 9.
- **KILL / DEFER:** full project-management replacement for Jira/GitHub; generic
  IDE expansion; mandatory cloud backend; Kubernetes; vector database before
  deterministic retrieval is evaluated; autonomous merge; infinite reviewer loops;
  exact deterministic LLM replay; public agent leaderboards; destructive memory
  deletion; provider-specific logic in the core domain.

## Target folder evolution

The repo evolves incrementally. The target layout:

```
contextgit/
  core/      models.py repo.py tasks.py agents.py events.py projects.py lifecycle.py
  adapters/  base.py registry.py (claude, codex, cursor, opencode, gemini, aider, terminal planned)
  services/  tasks orchestration context_compiler provenance verification review runtime skills
  context/   graph nodes edges compiler snapshots
  memory/    project bundle lifecycle
  knowledge/ models service providers exporters
  gitops/    repo worktree globs context integrate
  storage/   sqlite migrations/
  integration/ capture transcript runners usage
  agent/     service lifecycle approvals
  verify/    detect runner gates
  merge/     semantic queue readiness
  cli/       main task context trace
  api/       app tasks context provenance review
  mcp/       tools
```

`Repo` and `api/app.py` shrink over time. They remain compatibility entry points
while domain logic moves into services.

## V2 Alpha scope

The first V2 milestone contains only:

1. First-class canonical Tasks
2. Normalized agent/session events
3. Task-to-branch/worktree attachment
4. Dependency graph
5. Deterministic file/module claims
6. Structured Context Graph
7. Context Compiler V1
8. Basic Flight Recorder
9. Deterministic review checks
10. `IMPLEMENTED` versus `READY_TO_MERGE`

V2 Alpha is complete when:

- [ ] A user creates a Task from the CLI or desktop.
- [ ] The Task attaches to a branch, worktree, Session, and AgentRun.
- [ ] Dependencies and cycles are validated.
- [ ] Scope conflicts are detected before parallel execution.
- [ ] A deterministic context package is compiled and inspectable.
- [ ] Agent events and task evidence are stored with capture quality.
- [ ] Commits can be traced back to the Task.
- [ ] Verification results are attached to the Task.
- [ ] A Task cannot become `READY_TO_MERGE` without required evidence.
- [ ] Human approval remains required for merge.
- [ ] Existing sessions, Team boards, knowledge exports, and Git workflows keep working.

## Critical path

```
Architecture → Task Model → Agent Event Model → Coordination
  → Context Graph → Context Compiler → Provenance → Review Gates
```

## Success metrics

- **Coordination:** overlapping write scopes detected before merge; duplicate task
  rate; merge conflict rate for parallel tasks; blocked tasks with an explainable blocker.
- **Context:** average compiled size; reduction versus full history; included items
  with provenance; stale-memory frequency; exclusion accuracy from user feedback.
- **Execution:** completion rate; verification pass rate; retry rate; time from
  creation to implementation; time from implementation to merge readiness.
- **Review:** human review time; merged tasks with complete evidence; returned task
  rate; merge-readiness false-positive rate; sensitive-file changes that got review.
- **Economics:** cost per merged task; tokens per successful task; estimated vs
  provider-reported ratio; review cost by provider/model; verification failure cost.

## Build order

1. **Canonical Task/Session/AgentRun contract** (Phase 1 core).
2. **Normalized AgentEvent contract and fake adapter** (Phase 1 events).
3. **Deterministic claims and Context Compiler V1 together** (Phases 2–3).

Each step has acceptance criteria in its phase section above. Later phases
depend on stable Task identity and relationship models, so they follow Phase 1.
