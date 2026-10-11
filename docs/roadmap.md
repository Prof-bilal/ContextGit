# Roadmap

Version control for LLM conversations. Branch, diff, merge, roll back context — so a dead end costs one branch, not the whole context window.

## Why this, why now

Evidence that the problem is real and measurable:

- **Multi-turn degradation.** Across 200k+ simulated conversations and 15 production models, instructions delivered over multiple turns score on average **39% lower**; models anchor to prior answers and fail to course-correct (Laban et al., 2025). One wrong turn poisons the rest of the thread.
- **Context rot.** Adding ~10% irrelevant content to a prompt cut accuracy by up to 23% (Chroma, 2025). Abandoned explorations are exactly this kind of irrelevant payload.
- **Branching works.** ContextBranch (arXiv:2512.13914) showed branched conversations cut context size **58%** (31 → 13 messages) and improved response quality, with peak gains of 13.2% on conceptually distant explorations.
- **Lost in the middle.** Models attend U-shapedly; mid-context facts are effectively forgotten (Liu et al., 2024). Keeping context small and relevant matters more than window size.

**The gap:** existing tools do branching or forking only — LibreChat's fork copies messages into a new chat, Open WebUI ships a `/fork` command, GitChat renders a flowchart with editable nodes. None has immutable commits, three-level diffs, or a real merge. ContextBranch's "inject" is manual copy-paste. **Semantic merge with conflict detection and measured merge quality is the differentiator.**

## Prior art and positioning

| | Immutable commits | Branch isolation | Diff (msg/semantic/token) | Semantic merge | Conflict detection | Measured merge quality |
|---|---|---|---|---|---|---|
| ChatGPT/Claude edit-and-regenerate | – | – | – | – | – | – |
| LibreChat fork / Open WebUI fork | – | shallow copy | – | – | – | – |
| GitChat (React Flow) | – | node graph | – | – | – | – |
| ContextBranch (research) | content-addressed | yes | partial | inject (manual) | – | – |
| **ContextGit (this)** | ✓ SHA-256 | ✓ | ✓ three levels | ✓ summary commit | ✓ user-resolved | ✓ probe evals |

Design consequences from prior art: merges are summaries (never concatenations); the user always approves; the original branch is never deleted — merges are lossy by design, so quality must be measured, not assumed.

## Principles (from architecture.md, enforced every phase)

1. The core library is the single source of truth; CLI and API are thin wrappers.
2. Commits are immutable and content-addressed; branches/HEAD are pointers.
3. Every LLM call goes through the provider adapter; merge prompts are versioned files; structured output validated with Pydantic.
4. Local-first: one SQLite file; only LLM calls leave the machine.
5. Tests with every change; FakeProvider for anything deterministic; no real LLM in CI.

---

## Phase 1 — Core (week 1): a trustworthy tree

**Goal:** commit/branch/checkout that are provably correct. Nothing else matters if the tree lies.

- [x] Scaffold `contextgit` package: `core/`, `storage/`, `llm/`, `merge/`, `cli/` (see architecture.md)
- [x] Data model + canonical JSON hashing (sorted keys, UTF-8): same input → same commit id, always (data-model.md)
- [x] SQLite storage with numbered migrations; `commits`, `messages`, `branches`, `tags`, `repo_state`, `schema_version`
- [x] `init / commit / branch / checkout / log`; context reconstruction by parent-walk
- [x] `LLMProvider` protocol + `FakeProvider` (deterministic) + one real adapter with retry/backoff/timeout — *protocol + FakeProvider done; real adapter deferred to Phase 2, where the merge flow first calls out*
- [x] Basic Typer CLI mirroring the core API, `--json` flag
- [x] Property tests: hash determinism; checkout → build_context stability; deleting a branch never removes commits

*Done. Hashing is byte-compatible with the landing page demo (locked by fixtures generated from the JS); 61 tests pass, 93% coverage, `mypy --strict` and ruff clean.*

**Acceptance:** `ctx init && ctx commit && ctx branch && ctx checkout && ctx log` works end to end; `mypy --strict` clean on `core/`; 85%+ coverage on `core/` + `storage/`; hash invariance holds under Hypothesis.

**De-risk early:** the SHA-256 demo on the landing page is the spec — implement `canonical_commit` to match it exactly.

## Phase 2 — Diff & merge (weeks 2–3): the differentiator

**Goal:** merge meaning, not lines. This is the part nobody else ships; budget slack here.

- [x] Common-ancestor finder (LCA on the commit DAG)
- [x] Message diff + token diff from the ancestor (pure functions, no LLM)
- [x] Semantic diff: LLM extracts decisions / facts / dead ends / open questions per branch
- [x] Merge summarization: propose a compact summary commit; preview before anything is written
- [x] Conflict detection: contradictory decisions/facts between source and target; user resolves (pick a side or edit) — never auto-resolve silently (merge-engine.md)
- [x] `repo.merge(source, into, dry_run)` preview/apply core flow; persisted CLI preview/apply flow (HTTP routes deferred to Phase 3)
- [x] Dead-end notes (`kind: note`) so failed attempts survive as cheap context
- [x] Versioned prompt files under `merge/prompts/` with Pydantic-validated JSON output; focused deterministic tests
- [x] Configurable OpenAI-compatible chat-completions adapter (`CTX_LLM_API_KEY`, `CTX_LLM_BASE_URL`, `CTX_LLM_MODEL`)

**Acceptance:** the landing page's merge dialog is reproducible in the CLI: ancestor → extract → conflict → preview → apply; `test_merge_creates_commit_with_two_parents` passes; a merged context answers probe questions as well as the source branch (see evals below).

**Design guardrail:** if semantic extraction is unreliable, degrade gracefully — still produce the merge as "messages since ancestor, verbatim" and mark `summary_confidence: low`. Never block the user's merge on model quality.

## Phase 3 — Web UI (weeks 4–5): make the tree visible

**Goal:** three panels — graph, chat, inspector — backed by FastAPI + SSE (frontend.md, backend.md).

- [x] FastAPI routes under `/api/v1` (thin: validate → call core → return); SSE streaming chat
- [x] Graph panel (React Flow): commit graph, branch labels not just colors, click to select, keyboard navigable
- [x] Chat panel pinned to the selected commit; sending a message commits on the current branch
- [x] Inspector: token budget bar, summary, parents, health warnings placeholder
- [x] Merge preview dialog wired to the preview/apply API with explicit conflict resolution
- [x] Compare mode: same prompt to two branches, answers side by side
- [x] Scale-aware graph with pan/zoom/minimap and visible-branch traversal; Playwright e2e acceptance test

**Acceptance:** full branch → chat → merge loop in the browser; graph usable at 500+ commits; a11y: keyboard graph navigation, visible focus, no color-only encoding.

## Phase 5 — Desktop app (Electron): move the workbench off the web

**Goal:** one native window that owns its own local backend; the web keeps only the landing page.

- [x] `desktop/` scaffold: Electron main + preload + Vite renderer reusing `components/` and `lib/`
- [x] Backend lifecycle: main spawns uvicorn (dev) / PyInstaller binary (packaged), health-gates the window, error screen with restart
- [x] Electron-builder packaging (AppImage/deb/dmg/nsis) with the backend as an extraResource
- [x] Smoke test path: `CONTEXTGIT_SMOKE=1` verifies status + rendered DOM, exits with code
- [x] All existing checks stay green (74 tests, `mypy --strict`, ruff, root + desktop `tsc`, both builds)

*Done: dev and packaged apps both reach `ready` and mount the workbench against a fresh repo.*

## Phase 6 — Parallel AI runs (sessions + terminals)

**Goal:** BridgeMind-style sidebar: multiple agent sessions side by side (Claude, Codex, Gemini, or any CLI), commit on demand.

- [x] Core: `sessions` + staging table (migration), `repo.stage() / unstage() / commit_staged()`; sends land in the staging buffer by default (auto-commit toggle)
- [x] API: `/sessions`, `/staging` routes + tests
- [x] Electron PTY manager (node-pty) + xterm.js tabs with CLI presets (`claude`, `codex`, `gemini`, custom)
- [x] Sessions sidebar: live status dot, branch chip, per-session actions (commit…, branch here, switch, kill)
- [x] Commit-on-demand bar wired to staging; session ↔ branch binding

**Acceptance:** run two different agent CLIs in parallel, stage messages from each, commit on demand, see GitHub-style rows in History.

## Phase 7 — GitHub-style redesign

**Goal:** History as the primary view — graph column + commit rows, PR-style merge.

- [x] List/graph toggle; commit rows (kind icon, message, relative time, branch chips)
- [x] PR-style merge preview (changed decisions/facts as "files", conflict blocks)
- [x] Theming pass (GitHub-like light/dark), verify History minimap fix in dark mode

## Phase 8 — Web cleanup

**Goal:** the website keeps only the landing page.

- [x] Remove `/workbench` route + workbench links from the landing page (components stay shared: desktop imports them)
- [x] Move e2e to Playwright `_electron`; update `frontend.md` (desktop-first), `README`

## Phase 9 — Ideas backlog (researched, prioritized)

1. Transcript import (Claude Code JSONL / ChatGPT exports → root commits)
2. Semantic search across all history
3. Context packets + MCP server (any agent can pull "what we decided")
4. Time-travel replay · 5. Context health dashboard · 6. Merge-quality badge (probe evals in UI) · 7. Compare arena (N branches × M models) · 8. Automation hooks (auto-commit on idle, auto-tag on green probes) · 9. Budget & burn dashboard · 10. Local/offline provider (Ollama)

---

## Phase 4 — Polish & proof (week 6+)

- [ ] Cherry-pick, tags ("known-good"), export branch as plain prompt, import
- [ ] Context health checks: contradiction + staleness warnings (health/)
- [ ] Multi-model per branch; model recorded per commit
- [ ] Merge-quality eval suite in `tests/evals/` (below); README + demo recording
- [ ] PyPI packaging: `pip install contextgit`

**Acceptance:** eval suite runs locally with one command; docs updated; landing page claims all demonstrable.

---

## Merge-quality evals (the proof of the whole idea)

QA-based factual consistency: generate a fixed set of **probe questions** from the source branch before merging (where do counters live? what skew is tolerated? what was rejected and why?), ask them against the merged context after, and score retention. This is the QAGS / QAFactEval approach applied to context preservation. A lost fact is a failing eval; the merge prompt is revised until it passes. Keep runs in `tests/evals/`; not in CI (uses a real LLM); record pass rate per prompt version.

## Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Semantic merge quality is mediocre at first | high | Probe evals from day one; graceful degradation to verbatim-message merges; prompts versioned so quality is trackable |
| Conflict detection false positives annoy users | medium | Conflicts are advisory; user always approves; tune with eval runs |
| Token counts vary by provider/model | high | `count_tokens` behind the adapter; store the count used at commit time |
| LLM structured output drifts from schema | medium | Pydantic validation + one retry with the error appended; fail loud, never store invalid extractions |
| Graph slows at 500+ commits | medium | Collapse linear chains; virtualize; perf test in Phase 3 acceptance |
| Scope creep toward multi-user/cloud | medium | Out of scope until the single-user core is solid (architecture.md) |

## Out of scope (for now)

Multi-user auth, cloud sync, real-time collaboration, plugin API for other chat apps (parking lot), API proxy mode.
