-- 0014_editor_providers.sql
-- A third, isolated credential store, for the embedded editor's code
-- completions. Separate from `providers` (Chat) and `agent_providers`
-- (the asset agent) so the three never conflict.

CREATE TABLE editor_providers (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  vendor TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'cloud',
  capability TEXT NOT NULL DEFAULT 'chat',
  base_url TEXT NOT NULL,
  auth_style TEXT NOT NULL DEFAULT 'bearer',
  api_key TEXT,
  default_model TEXT,
  models_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
