# Data Model

## Entities
**Message**: `role` (system|user|assistant|tool), `content`, `created_at`

**Commit** (immutable)
- `id`: SHA-256 of canonical JSON of (parent_ids, messages, metadata)
- `parent_ids`: list (1 normally, 2 for merge commits)
- `messages`: list[Message], only the messages added in this commit
- `summary`: short LLM-generated description (optional)
- `metadata`: model, token_count, created_at, author, kind
- `kind`: `normal` | `merge` | `note` (dead-end note) | `root`

**Branch**: `name`, `head_commit_id`
**Ref/Tag**: `name`, `commit_id`, `label` (e.g. "known-good")
**Repo state**: current branch name (HEAD)

## Rules
- Reconstructing context = walking parents from a commit and concatenating messages.
- Merge commits store two parents and a summary message, not the branch's full messages.
- Deleting a branch never deletes commits.
- Hashing must be deterministic: sorted keys, UTF-8, no whitespace variance.

## SQLite tables
`commits`, `messages`, `branches`, `tags`, `repo_state`, `schema_version`.
Schema changes require a numbered migration in `storage/migrations/`.
