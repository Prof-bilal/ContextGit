# Team mode — Round 2: making the idea strong

> Research round 2 of 3. Companions: `team-mode-landscape.md`,
> `team-mode-architecture.md`. Verified 2026-10-03.

## The data: teams fail on coordination, not capability

- Multi-agent LLM systems fail in production at **41–86.7%** of deployments.
- The **MAST taxonomy** (NeurIPS 2025, 1,600+ traces):
  - **Specification problems — 41.77%** (role ambiguity, vague tasks, missing constraints)
  - **Coordination failures — 36.94%** (state sync, communication breakdown, conflicting goals)
  - **Verification gaps — 21.30%** (no independent check of outputs)
- Agents don't infer; every ambiguity becomes a wrong decision. Fix = **specs as
  contracts + structured messaging + independent validation**, not a bigger model.
- PwC got **7× accuracy** from structured validation loops; an independent judge
  agent improved mitigation success **1.5×**.

## Ten rules that make team mode work

1. **Spec-as-contract.** Every task gets a machine-checkable **definition of done**,
   explicit **scope** (path globs), and a **role**. Vague spec × N runs = N wrong
   directions.
2. **Task graph, not a prompt.** Tasks are nodes, dependencies are edges; a
   blocked task cannot start until its deps complete.
3. **One file, one owner.** Structural conflicts (~42% of real conflicts) come
   from two agents on one file. Block overlapping claims; give contract files
   (`openapi.yaml`, `src/types/api.ts`, `package.json`) exactly one owner.
4. **Peer messaging, not everything through the lead** — backend tells frontend
   the contract directly.
5. **Independent verification** — the reviewer is never the implementer; separate
   context, separate model; findings ranked by severity.
6. **Plan approval for risky work** — catching a bad plan is cheaper than bad code.
7. **Quality gates as hooks** — on task-complete run tests/lint/type-check;
   failure keeps the agent working.
8. **WIP limits + kill criteria** — 3–5 agents is the sweet spot; per-run token
   budget; kill after ~3 stuck iterations.
9. **Human-curated shared memory** — LLM-written `AGENTS.md` gives no benefit and
   can reduce success (~3%) while raising cost (>20%); developer-written helps
   (~4%). Agents may *propose*; a human merges.
10. **Decision traces** — record which context/source/decision shaped each output.

## "Never conflict" — what's actually guaranteed

| Conflict type | Guarantee | Mechanism |
|---|---|---|
| Two agents editing the same file | **Prevented** | worktree per run + **enforced** claims |
| Same file, merge-time overlap | **Detected early** | overlap radar + `git merge-tree` preflight |
| Contradictory designs (JWT vs sessions) | **Detected, needs a human** | cross-run semantic conflict check + verifier |
| Contract drift (frontend guesses API) | **Prevented** | single-owner contract file + handoff notification |

Files are deterministic; meaning is not. Make the deterministic part impossible to
get wrong and the meaning part visible.

## Sharpened concept: Single | Team

**Single** — one agent, one terminal, one branch. Unchanged.

**Team** — you define a **mission**, decomposed into **tasks**:

```
task: api-contract   role: backend   scope: [src/api/**, openapi.yaml]   deps: []
task: frontend       role: frontend  scope: [src/web/**]                 deps: [api-contract]
task: tests          role: qa        scope: [tests/**]                   deps: [api-contract, frontend]
task: review         role: verifier  scope: []                           deps: [tests]
```

Launching the team:
1. Worktree + branch per task; scopes, roles and deps written to the shared board.
2. Start unblocked tasks; gated tasks show "waiting on `api-contract`".
3. When `api-contract` completes, the coordinator **publishes the contract** and
   **notifies** `frontend`, which then builds against the real endpoints.
4. `review` runs as an independent verifier; only green tasks enter the merge queue.
5. The queue merges in dependency order, re-checking after each; merging a run
   brings its **code and conversation** together.

## The differentiator

1. **Worktree ⇄ context pairing** — merging a run merges its diff *and* its reasoning.
2. **Enforced ownership + contract files** — claims that block; one owner per interface.
3. **Cross-run semantic conflict detection** — flag contradictory decisions before
   the code merge.
4. **Verifier as a first-class role** wired to the merge queue.
5. **Live board + MCP channel** so agents ask peers on demand.

## Anti-patterns

- Too many agents (cap 3–5; the 5th is the verifier).
- Vague tasks — ambiguity × N agents.
- Shared mutable files without an owner.
- Auto-writing `AGENTS.md`.
- Merging concurrently.
- Trusting green tests — "verification is the bottleneck, not generation."

## Sources

- [Why multi-agent LLM systems fail (MAST, Augment)](https://www.augmentcode.com/guides/why-multi-agent-llm-systems-fail-and-how-to-fix-them)
- [Context engineering for multi-agent systems (Atlan)](https://atlan.com/know/context-engineering/context-engineering-for-multi-agents/)
- [Addy Osmani — The Code Agent Orchestra](https://addyosmani.com/blog/code-agent-orchestra/)
- [Multi-agent coordination failures](https://avchauzov.github.io/blog/2026/multi-agent-coordination-failures/)
- [When Agents Collide (33,596 agent PRs)](https://codex.danielvaughan.com/2026/07/28/agent-pr-merge-conflicts-concurrent-coding-agents-codex-cli-worktree-isolation-coordination-defence/)
