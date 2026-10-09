ALTER TABLE branches ADD COLUMN project_path TEXT;

UPDATE branches
SET project_path = (
    SELECT project_path
    FROM sessions
    WHERE sessions.branch = branches.name
      AND sessions.project_path IS NOT NULL
    ORDER BY sessions.created_at DESC
    LIMIT 1
)
WHERE project_path IS NULL;

CREATE INDEX idx_branches_project ON branches(project_path, deleted_at);
