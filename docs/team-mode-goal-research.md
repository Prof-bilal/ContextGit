# ContextGit Team Mode: goal-driven agent teams

Date: 2026-10-15  
Status: Research and proposed implementation; not implemented by this document.

## Recommendation

Build **one parent agent supported by a durable ContextGit supervisor**, with
specialist workers running through adapters for installed agent tools.

The workflow is:

**Enter goal → parent researches and proposes plan → approve once → workers
execute → verify and integrate onto goal branch → final review.**

This recommendation combines four product research tracks and three architecture
assessments, grounded in the current repository and primary sources.

Confirmed product decisions:

- Approve the execution plan once.
- Include all installed agent tools, showing their supported capabilities.
- Collect verified work on a dedicated goal branch for final review.

## 1. Findings from four product research tracks

### Research 1: Goal and parent-agent experience

ContextGit already has Team/Task models, dependency graphs, isolated worktrees,
scope claims, messages, quality gates, verifier sessions, and integration jobs.
The main addition is **automatic goal planning and supervision**.

The parent should:

- Inspect the repository and clarify material requirements.
- Propose tasks, dependencies, responsibilities, skills, and acceptance checks.
- Choose useful parallel work and assign suitable installed tools.
- Handle blockers, coordinate handoffs, and propose bounded repairs.
- Explain the finished result with supporting evidence.

The parent should choose team size based on the work. Parallel research and
separate modules are good candidates; tightly sequential changes and shared-file
edits often benefit from fewer workers.
[Claude team guidance](https://code.claude.com/docs/en/agent-teams)

### Research 2: Skills, tools, and context

Current role “skills” are mostly labels and brief checklists. They are not complete
`SKILL.md` packages.

Introduce three separate concepts:

- **Role:** a responsibility template, such as backend developer.
- **Skill:** instructions and resources for a particular workflow.
- **Capability:** an operation the selected runtime can actually perform.

Discover skill metadata first, load relevant instructions when selected, and
retrieve supporting resources when needed. This follows the standard’s
progressive loading approach.
[Agent Skills specification](https://agentskills.io/specification)

Each worker receives a focused context bundle containing its task, acceptance
criteria, repository instructions, selected skills, relevant approved memory,
and prerequisite artifacts. Record source references and content hashes so
recovery uses the same instructions.

Discover project skills, approved user skills, and bundled skills. Preserve source
namespaces, surface duplicate names, and validate compatibility before launch.
Do not install a remote skill merely because a parent names it. Skill instructions
cannot expand a worker’s execution authority.

### Research 3: Reliability and completion

The parent’s judgment must be supported by backend rules for scheduling,
ownership, verification, and integration.

Two current gaps need attention:

- A dependent task can start from the original team base without receiving its
  prerequisite’s accepted code.
- A verifier’s “read-only” instruction is not itself an enforced permission
  boundary.

Workers submit artifacts and evidence. Checks and independent review establish
acceptance. Terminal exit, silence, or an agent saying “done” cannot establish
completion.

Research identifies specification, coordination, and verification as distinct
sources of multi-agent failure.
[MAST research](https://arxiv.org/abs/2503.13657)

### Research 4: Product value and scope

The strongest differentiator is **versioned context that travels with verified
code**:

**Goal → approved plan → decisions → skills → worker artifact → checks/review →
integration.**

A replacement worker should inherit accepted decisions and rejected approaches
without repeating the investigation.

Measure success through completed goals, recovery quality, supervision required,
elapsed time, and usage. More agents are not automatically better: empirical
results vary substantially with task structure and coordination design. These
results are not predictions of ContextGit coding speed.
[Scaling agent systems research](https://arxiv.org/abs/2512.08296)

Cursor’s coding experiments also support separating planning and execution while
avoiding excessive coordination complexity. Treat these as engineering
observations, rather than a controlled guarantee of team superiority.
[Scaling long-running autonomous coding](https://cursor.com/blog/scaling-agents)

## 2. Decisions from three architecture assessments

### Assessment 1: ContextGit owns orchestration

Use ContextGit’s backend as the authoritative supervisor. Installed CLIs execute
individual attempts through adapters.

Provider-native teams can become an optional optimization later. Making them
authoritative now would introduce competing task graphs, concurrency limits,
and recovery behavior across providers.

The parent proposes operations; the backend validates and performs them.

Component responsibilities:

- **Parent agent:** planning, assignment proposals, reasoning about blockers,
  bounded replanning, and final synthesis.
- **Team domain service:** approval, policy, transitions, dependencies, limits,
  and acceptance rules.
- **Supervisor:** durable scheduling, runtime attempts, lifecycle events,
  cancellation, and reconciliation.
- **Runtime adapters:** translating installed tool protocols into common
  lifecycle operations and events.
- **Integration service:** candidate construction, review/checks, and publication.
- **Desktop, API, CLI, and MCP:** clients of the same domain operations.

### Assessment 2: Extend SQLite and the existing backend

Use a small, explicit state machine backed by ContextGit’s existing SQLite
storage.

LangGraph offers useful checkpointing, but ContextGit would still need to
reconcile external processes, worktrees, and Git publication. Introducing a
second execution-state system adds complexity without removing those
responsibilities.
[LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence)

Temporal becomes worth reconsidering for distributed execution across machines.
Its activity model still requires repeatable or idempotent external operations.
[Temporal activities](https://docs.temporal.io/activities)

This is a repository-specific choice: extend the infrastructure already
responsible for teams and integration. A reasoning framework can later sit behind
the parent interface without becoming the owner of authoritative Team state.

### Assessment 3: Reuse integration with goal-specific authority

Reuse the existing candidate, review, checks, publication, and recovery pipeline
in `contextgit/integration/service.py`.

Add **goal-scoped integration authority**. Existing integration settings are
project-wide; changing their target to a goal branch could redirect unrelated
work.

Each goal gets:

- A dedicated `contextgit/goal/<id>` branch created from an exact commit.
- An approved plan revision and check configuration.
- Authority limited to updating that branch.
- Its own authority generation for cancellation and recovery.

Keep existing project integration settings intact. Record authority scope and
generation on integration jobs. Serialize publication with the existing project
lock for the first version. Revalidate authority under the publication lock so a
revoked or stale supervisor cannot publish.

## 3. Implementation design and first-release features

### Backend ownership and persistence

Extend existing teams/tasks rather than creating a separate task system. The
existing pure DAG logic in `contextgit/core/team.py` remains the foundation for
dependency reasoning.

Add:

- **Goal:** objective, acceptance criteria, lifecycle, branch, approved plan,
  limits, final verified commit.
- **Plan revision:** immutable task graph, assignments, skills, checks, and
  approval receipt.
- **Task attempt:** runtime identity, session/worktree, exact base commit,
  lifecycle, outcome, and evidence.
- **Durable operation:** unique operation identifier and receipt for launch,
  worktree creation, and integration effects.

Reserve task ownership, capacity, and claims atomically. Perform Git and runtime
operations outside database transactions, then persist their results. Reconcile
interrupted operations before retrying. Use a supervisor lease and generation
checks to prevent stale ownership from performing authoritative transitions.

Separate task identity from attempt identity. Retrying creates a new attempt and
preserves earlier evidence. Record exact native runtime session identifiers;
never resume an arbitrary “last” conversation.

Run supervision in the backend lifecycle. Closing an automated worker’s panel
must not terminate its execution. Backend shutdown preserves recoverable state;
uninterrupted background execution after quitting the app is outside the first
release. Recovery reconciles runtime identity, processes, worktrees, logs, and
Git refs; it must not promise exactly-once external execution.

### Runtime adapters and installed tools

Provide a common adapter interface for capability discovery, start, events,
messaging, interruption, stopping, and resume where available.

Show four capability levels:

- **Managed:** structured lifecycle and reliable supervision.
- **Batch:** bounded noninteractive execution.
- **Assisted:** interactive terminal participation requiring human help.
- **Unavailable:** missing executable, authentication, or required configuration.

Include every registered installed tool through an appropriate level. The current
catalog includes Claude Code, Codex, OpenCode, Antigravity, Aider, Ollama,
Freebuff, Cline, Pi, Kilo, and Command Code, plus Shell. Reconcile discovery with
legacy supported tools such as Gemini rather than silently excluding them.

Certify automation per adapter; executable presence alone does not prove
readiness. Unsupported resume, permissions, or usage telemetry remain visible.
Do not treat raw model inference or a shell as a complete repository-editing
agent.

Use existing structured runner patterns for initial Codex and Claude adapters,
preserving the existing restricted reviewer policy. Other tools participate
through certified managed/batch adapters or assisted mode; full automation for
every tool is not a release prerequisite.

Keep automated processes backend-owned. Assisted terminals retain host ownership
and report lifecycle through a narrow bridge. Losing an assisted host produces an
interrupted or unknown attempt, not a fabricated successful result.

### Scheduling, handoffs, and acceptance

- Schedule only dependency-ready tasks with available capacity and nonconflicting
  claims.
- Start code workers from a recorded goal-branch commit containing accepted
  prerequisite changes, rather than the original team base.
- Reference non-code handoffs through immutable artifacts.
- Bind checks and reviews to exact commits; changed code invalidates previous
  evidence.
- Validate changed paths against approved scope before acceptance. Worktrees and
  ownership claims are coordination mechanisms, not filesystem sandboxes.
- Integrate accepted tasks onto the goal branch through the existing integration
  service.
- Run combined goal-level checks before reporting `ready_for_review`.

Parent and worker tools must be bound to their goal and attempt. Workers cannot
approve themselves or change publication targets. Runtime permissions must match
the task policy; a prompt alone cannot enforce a read-only verifier.

Persist typed questions, handoffs, contracts, review feedback, and failures with
task/artifact references. Deliver relevant messages rather than copying every
worker transcript into the parent context.

### User controls

Extend the Team screen with:

- Goal entry and parent planning conversation.
- Editable plan, assignments, dependencies, and selected skills.
- One plan-approval action.
- Progress, blockers, requests for input, checks, and usage.
- Inspectable worker sessions, diffs, and handoffs.
- Pause/resume/cancel goal; message, interrupt, or retry a worker.
- Final review of the exact verified goal-branch commit.

Pause prevents new launches and publication while existing workers may settle.
Cancel revokes authority and terminates owned processes where supported,
preserving artifacts. Cancellation is not rollback of work already published to
the goal branch.

### Interfaces and event delivery

Expose shared domain operations through API, CLI, MCP, and desktop:

- Create/read goal and propose/read plan revisions.
- Approve a specific plan revision with optimistic version checking.
- Start, pause, resume, and cancel a goal.
- Read events, attempts, blockers, usage, and artifact evidence.
- Submit an artifact for the current attempt and exact source commit.
- Request scope/plan changes for backend validation.
- Run goal verification against an exact goal-branch commit.

Persist lifecycle events with monotonically increasing IDs and cursor-based
replay. Use SSE or existing polling transport over that event history. Keep large
terminal logs separate from lifecycle events. Generated board files and managed
instruction blocks remain projections; SQLite is authoritative.

Further changes to the goal branch invalidate its previous final verification.
Human acceptance of the final result is distinct from task acceptance onto the
goal branch.

## 4. Validation, delivery order, and defaults

### Required validation

Test meaningful failure and correctness scenarios:

- Concurrent scheduler ticks cannot duplicate launches or exceed capacity.
- Dependent checkouts contain accepted prerequisite code.
- Checks for commit A cannot approve commit B.
- Goal integration cannot redirect ordinary project integration or another goal.
- Cancellation and publication obey the same authority lock.
- Restart after launch or publication recovers without blind replay.
- Missing skills and incompatible adapters fail visibly.
- Workers cannot approve another task or expand their own authority.
- Assisted-terminal loss never produces successful completion.
- Goal readiness requires accepted tasks and passing combined checks.

Compare team and single-agent execution on 12–20 representative repository goals.
Track acceptance rate, time to verified result, actual/estimated usage,
interruptions, rework, and recovery. Include small fixes and sequential work so
the evaluation can reveal when parallelism is counterproductive.

### Delivery order

1. Add goal/plan/attempt persistence and correct dependency handoffs.
2. Add the durable supervisor, runtime contract, and capability discovery.
3. Add parent planning, real skill loading, and scoped context.
4. Connect verification and goal-scoped integration.
5. Add the goal workspace UI and adapter conformance suite.

Preserve existing manually managed teams through additive migrations and an
explicit goal-driven mode. Reconcile older Team documentation that describes
generated board files as authoritative or implies role labels are full skill
loading.

### Defaults and boundaries

- One parent; up to **three concurrent non-parent agents**, including reviewers.
- No recursive worker spawning in the first release.
- Two automatic retry/repair attempts per task; repeated failure moves the goal
  to needs-attention.
- In-scope replanning proceeds automatically; material changes to behavior,
  authority, or limits require renewed approval.
- Usage is labelled actual, estimated, or unknown. Hard spend enforcement is
  offered only where telemetry supports it.
- Local, single-repository execution first; final project-branch merge remains a
  user action.
- Remote workers, nested teams, skill marketplaces, and cloud orchestration
  follow after the core workflow proves reliable.

The three-agent limit and retry policy are proposed product defaults, not
research-established optima. They should be evaluated with representative goals.
