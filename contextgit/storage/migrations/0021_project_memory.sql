CREATE TABLE project_memory_revisions (
    id TEXT PRIMARY KEY,
    project_path TEXT NOT NULL,
    revision INTEGER NOT NULL,
    status TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    architecture TEXT NOT NULL DEFAULT '[]',
    workflow TEXT NOT NULL DEFAULT '[]',
    conventions TEXT NOT NULL DEFAULT '[]',
    decisions TEXT NOT NULL DEFAULT '[]',
    rejected TEXT NOT NULL DEFAULT '[]',
    skills TEXT NOT NULL DEFAULT '[]',
    validation TEXT NOT NULL DEFAULT '[]',
    open_questions TEXT NOT NULL DEFAULT '[]',
    conflicts TEXT NOT NULL DEFAULT '[]',
    source_session_ids TEXT NOT NULL DEFAULT '[]',
    source_commit_ids TEXT NOT NULL DEFAULT '[]',
    provider TEXT,
    model TEXT,
    created_at TEXT NOT NULL,
    approved_at TEXT
);
CREATE UNIQUE INDEX idx_project_memory_revision ON project_memory_revisions(project_path, revision);
CREATE INDEX idx_project_memory_current ON project_memory_revisions(project_path, status, revision);
