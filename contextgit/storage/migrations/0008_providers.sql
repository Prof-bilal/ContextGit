-- 0008_providers.sql
-- Locally stored LLM providers: a key for a built-in, or a whole custom endpoint.
--
-- `api_key` never leaves the machine and is redacted before it crosses the API;
-- the provider registry reads this row to build the right adapter. Built-in
-- catalog rows live in code (contextgit/llm/spec.py); this table only holds the
-- user's overrides and additions.

CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  vendor TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'cloud',
  base_url TEXT NOT NULL,
  auth_style TEXT NOT NULL DEFAULT 'bearer',
  api_key TEXT,
  default_model TEXT,
  models_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
