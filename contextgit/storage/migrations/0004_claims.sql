-- 0004_claims.sql
-- A run's claimed file scope: the path globs it intends to own. Two runs whose
-- claims overlap are warned before they collide (the module-ownership defence).

CREATE TABLE claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    path_glob TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (session_id, path_glob)
);

CREATE INDEX idx_claims_session ON claims(session_id);
