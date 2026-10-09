CREATE TABLE issue_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE issue_scan_runs (
    id TEXT PRIMARY KEY,
    commit_sha TEXT,
    trigger TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    counts TEXT NOT NULL DEFAULT '{}',
    error TEXT
);

CREATE TABLE issue_findings (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES issue_scan_runs(id),
    fingerprint TEXT NOT NULL,
    scanner TEXT NOT NULL,
    rule_id TEXT NOT NULL,
    severity TEXT NOT NULL,
    confidence REAL NOT NULL,
    title TEXT NOT NULL,
    location TEXT,
    evidence TEXT NOT NULL,
    why TEXT NOT NULL,
    fix TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL
);
CREATE INDEX idx_issue_findings_fingerprint ON issue_findings(fingerprint);
CREATE INDEX idx_issue_findings_run ON issue_findings(run_id);

CREATE TABLE issue_links (
    fingerprint TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    issue_number INTEGER NOT NULL,
    issue_url TEXT NOT NULL,
    state TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
