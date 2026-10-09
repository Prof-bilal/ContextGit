-- Additive: old history and schemas remain untouched.
CREATE TABLE harness_bindings (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    harness TEXT NOT NULL,
    native_id TEXT NOT NULL,
    directory TEXT NOT NULL,
    UNIQUE(harness, native_id)
);
CREATE TABLE captured_messages (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL,
    message_json TEXT NOT NULL,
    commit_id TEXT REFERENCES commits(id) ON DELETE SET NULL,
    PRIMARY KEY(session_id, source_id)
);
CREATE INDEX idx_capture_pending ON captured_messages(session_id, commit_id);
