# Backend Guide

**Stack:** Python 3.11+, FastAPI, Pydantic v2, SQLite (`sqlite3`/SQLAlchemy core), Typer for CLI.

## Core library API (the contract)
```python
repo = Repo.init(path)
repo.commit(messages, model=..., summary=None) -> Commit
repo.branch(name, from_commit=None) -> Branch
repo.checkout(name_or_id)
repo.log(branch=None) -> list[Commit]
repo.diff(a, b) -> Diff
repo.merge(source, into="main", dry_run=False) -> MergeResult
repo.cherry_pick(commit_id, onto_branch)
repo.tag(name, commit_id, label=None)
repo.build_context(commit_id) -> list[Message]
repo.count_tokens(commit_id, model) -> int
```

## API conventions
- REST under `/api/v1`. JSON in, JSON out.
- Chat responses stream via SSE at `POST /api/v1/chat/stream`.
- Request/response models live in `api/schemas.py`. Routes only validate, call core, and return.
- Errors: raise domain exceptions in core (`BranchNotFound`, `MergeConflict`); API maps them to HTTP codes in one exception handler.
- Merge is a two-step flow: `POST /merge/preview` then `POST /merge/apply`.

## LLM adapter
```python
class LLMProvider(Protocol):
    def complete(self, messages, **opts) -> str: ...
    def stream(self, messages, **opts) -> Iterator[str]: ...
    def count_tokens(self, messages) -> int: ...
```
- API keys come from environment variables, never from code or the database.
- Add retries with backoff and a timeout on every call.
- A `FakeProvider` (deterministic) is required for tests.

## CLI
Commands mirror the core API: `ctx init|commit|branch|checkout|log|diff|merge|tag`.
CLI output must be readable by humans; add `--json` for machine output.
