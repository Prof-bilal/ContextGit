CREATE TABLE agent_runs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    task TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    base_commit TEXT,
    worktree_path TEXT,
    status TEXT NOT NULL,
    plan TEXT,
    resulting_commit TEXT,
    local_issue_id TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE agent_steps (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES agent_runs(id),
    sequence INTEGER NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    input_summary TEXT NOT NULL,
    output_summary TEXT NOT NULL,
    files TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
);
CREATE INDEX idx_agent_steps_run ON agent_steps(run_id, sequence);

CREATE TABLE agent_approvals (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES agent_runs(id),
    step_id TEXT NOT NULL REFERENCES agent_steps(id),
    approval_type TEXT NOT NULL,
    action TEXT NOT NULL,
    decision TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE agent_artifacts (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES agent_runs(id),
    kind TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE local_issues (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL,
    labels TEXT NOT NULL DEFAULT '[]',
    source TEXT NOT NULL,
    agent_run_id TEXT,
    commit_id TEXT,
    branch TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX idx_local_issues_updated ON local_issues(updated_at);
