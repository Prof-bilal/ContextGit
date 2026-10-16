ALTER TABLE sessions ADD COLUMN category TEXT NOT NULL DEFAULT '';
CREATE TABLE knowledge_records (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    project_path TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('checkpoint', 'lesson')),
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX knowledge_project ON knowledge_records(project_path, kind, updated_at);
