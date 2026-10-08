CREATE TABLE integration_settings (
 project TEXT PRIMARY KEY, payload TEXT NOT NULL
);
CREATE TABLE integration_jobs (
 id TEXT PRIMARY KEY, project TEXT NOT NULL, target TEXT NOT NULL,
 session_id TEXT NOT NULL, source_sha TEXT NOT NULL, payload TEXT NOT NULL,
 UNIQUE(project, target, session_id, source_sha)
);
