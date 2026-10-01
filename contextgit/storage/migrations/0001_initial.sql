-- 0001_initial.sql
-- Tables: commits, messages, branches, tags, repo_state, schema_version.
-- Commits are immutable; branches/HEAD are mutable pointers.

CREATE TABLE commits (
    id TEXT PRIMARY KEY,
    parent_ids TEXT NOT NULL,          -- JSON array of commit ids
    kind TEXT NOT NULL CHECK (kind IN ('normal', 'merge', 'note', 'root')),
    model TEXT NOT NULL,
    summary TEXT,
    token_count INTEGER NOT NULL DEFAULT 0,
    author TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    commit_id TEXT NOT NULL REFERENCES commits(id),
    seq INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (commit_id, seq)
);

CREATE INDEX idx_messages_commit ON messages(commit_id, seq);

CREATE TABLE branches (
    name TEXT PRIMARY KEY,
    head_commit_id TEXT NOT NULL REFERENCES commits(id)
);

CREATE TABLE tags (
    name TEXT PRIMARY KEY,
    commit_id TEXT NOT NULL REFERENCES commits(id),
    label TEXT
);

CREATE TABLE repo_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    current_branch TEXT NOT NULL
);

CREATE TABLE schema_version (
    version INTEGER NOT NULL
);
