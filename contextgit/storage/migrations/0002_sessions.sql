-- 0002_sessions.sql
-- Sessions (parallel AI runs) and their staging buffer (commit on demand).
-- Staged messages are not commits; commit_staged() moves them onto the
-- session's branch as one immutable commit, then clears the buffer.

CREATE TABLE sessions (
    id TEXT PRIMARY KEY,            -- uuid4 hex
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('chat', 'terminal')),
    branch TEXT NOT NULL,           -- no FK: a deleted branch fails loudly in repo, not on cascade
    status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'done', 'error')),
    agent TEXT,                     -- CLI preset (claude/codex/gemini/...) for terminal sessions
    auto_commit INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_sessions_branch ON sessions(branch);

CREATE TABLE staging (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (session_id, seq)
);

CREATE INDEX idx_staging_session ON staging(session_id, seq);
