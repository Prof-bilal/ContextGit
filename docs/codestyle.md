# Code Style

## Python
- Python 3.11+, full type hints on all public functions. `mypy --strict` on `core/`.
- Format with `ruff format`, lint with `ruff check`. Line length 100.
- Pydantic models for anything crossing a boundary (API, LLM output, storage).
- Prefer small pure functions; keep side effects in the repo/storage layer.
- No bare `except`. Raise specific domain exceptions from `core/errors.py`.
- Docstrings on public classes and functions (one-line summary + args if non-obvious).
- No global mutable state. Pass dependencies in explicitly.

## TypeScript / React
- `strict` mode on. No `any`, no non-null `!` without a comment.
- Function components and hooks only. One component per file, PascalCase filenames.
- Format with Prettier, lint with ESLint.
- Prefer composition over prop drilling; keep components under ~150 lines.

## Naming
- Python: `snake_case` functions, `PascalCase` classes. TS: `camelCase` values, `PascalCase` types.
- Names describe intent: `build_context`, not `get_data`.

## Git & commits
- Conventional commits: `feat:`, `fix:`, `test:`, `docs:`, `refactor:`.
- Small PRs, one concern each.

## Comments
Explain *why*, not *what*. Delete commented-out code.

## Secrets & config
Config via environment variables loaded in one place (`config.py`). Never commit keys.
