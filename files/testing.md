# Testing

## Tools
Backend: `pytest`, `pytest-cov`, `hypothesis` (property tests). Frontend: `vitest`, React Testing Library, Playwright (e2e).

## Layers
| Layer | What | Notes |
|---|---|---|
| Unit | hashing, commit building, branch ops, token counting | Fast, no I/O, no network |
| Integration | Repo + SQLite, API routes via `TestClient` | Use temp DB per test |
| Merge evals | probe-question retention before/after merge | Separate, may use a real LLM, not run in CI by default |
| E2E | branch → chat → merge flow in browser | Playwright, uses FakeProvider |

## Rules
- **Never call a real LLM in unit or integration tests.** Use `FakeProvider`.
- Every bug fix ships with a regression test.
- Property tests for invariants: same input → same commit hash; checkout(commit) then build_context is stable; deleting a branch never removes commits.
- Test names describe behavior: `test_merge_creates_commit_with_two_parents`.
- Target: 85%+ coverage on `core/`, `merge/`, `storage/`.

## Commands
```
pytest -q                    # backend
pytest --cov=contextgit      # with coverage
npm --prefix web run test    # frontend unit
npm --prefix web run e2e     # playwright
```

## Definition of done
Tests pass, new behavior is covered, lint and type checks are clean.
