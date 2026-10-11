-- Bounded fallback transcript for terminal sessions without native capture.
CREATE TABLE terminal_transcripts (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    content TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);
