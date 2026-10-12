# Testing

## Tools
Backend: `pytest`, `pytest-cov`, `hypothesis` (property tests). Desktop: Tauri typecheck, renderer build, Rust checks, and installed-artifact smoke tests.

## Layers
| Layer | What | Notes |
|---|---|---|
| Unit | hashing, commit building, branch ops, token counting | Fast, no I/O, no network |
| Integration | Repo + SQLite, API routes via `TestClient` | Use temp DB per test |
| Merge evals | probe-question retention before/after merge | Separate, may use a real LLM, not run in CI by default |
| Desktop smoke | backend readiness, project selection, terminal lifecycle, and window ownership | Tauri packaged application |

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
npm run build --prefix website # Next.js marketing build + TS check
npm run build --prefix desktop  # desktop renderer + backend bundle
npm run tauri:build --prefix desktop  # installed Tauri artifacts
```

## Definition of done
Tests pass, new behavior is covered, lint and type checks are clean.
