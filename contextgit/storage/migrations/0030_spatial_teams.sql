-- Spatial multi-team workspace: orchestration state, approved plans and canvas layout.

ALTER TABLE teams ADD COLUMN goal TEXT NOT NULL DEFAULT '';
ALTER TABLE teams ADD COLUMN state TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE teams ADD COLUMN orchestrator_agent TEXT;
ALTER TABLE teams ADD COLUMN orchestrator_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL;
ALTER TABLE teams ADD COLUMN archived_at TEXT;

CREATE TABLE team_plan_revisions (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    plan TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(team_id, revision)
);

CREATE TABLE canvas_layouts (
    team_id TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
    x REAL NOT NULL DEFAULT 80,
    y REAL NOT NULL DEFAULT 80,
    width REAL NOT NULL DEFAULT 960,
    height REAL NOT NULL DEFAULT 620,
    collapsed INTEGER NOT NULL DEFAULT 0,
    z_index INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);

CREATE TABLE skill_links (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    agent TEXT,
    skill_id TEXT NOT NULL,
    origin TEXT NOT NULL DEFAULT 'project',
    title TEXT NOT NULL,
    instruction TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE canvas_viewports (
    project_path TEXT PRIMARY KEY,
    x REAL NOT NULL DEFAULT 0,
    y REAL NOT NULL DEFAULT 0,
    zoom REAL NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_team_plans_team ON team_plan_revisions(team_id, revision);
CREATE INDEX idx_skill_links_team ON skill_links(team_id);
