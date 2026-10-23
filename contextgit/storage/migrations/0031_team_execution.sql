-- Opt-in parent-led execution; old teams retain their existing merge behavior.
CREATE TABLE team_execution (
    team_id TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
    settings TEXT NOT NULL
);
CREATE TABLE team_integrations (
    task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    payload TEXT NOT NULL
);
