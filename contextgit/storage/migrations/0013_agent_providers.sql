-- 0013_agent_providers.sql
-- A second, isolated credential store for the asset agent. Same shape as
-- `providers`, but a separate table so the agent's endpoints never appear in the
-- Chat provider picker and the two stores cannot conflict.

CREATE TABLE agent_providers (
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
