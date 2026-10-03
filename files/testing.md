# Testing

## Tools
Backend: `pytest`, `pytest-cov`, `hypothesis` (property tests). Desktop: Playwright `_electron` (e2e against the built app).

## Layers
| Layer | What | Notes |
|---|---|---|
| Unit | hashing, commit building, branch ops, token counting | Fast, no I/O, no network |
| Integration | Repo + SQLite, API routes via `TestClient` | Use temp DB per test |
| Merge evals | probe-question retention before/after merge | Separate, may use a real LLM, not run in CI by default |
| E2E | sessions sidebar, history list, terminal session in the desktop app | Playwright `_electron`, uses FakeProvider |

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
npm run build               # Next.js landing build + TS check
npm run build --prefix desktop  # desktop renderer + electron bundles (required for e2e)
npm run test:e2e             # Playwright desktop flow (Electron app spawns its own backend)
```

## Definition of done
Tests pass, new behavior is covered, lint and type checks are clean.
