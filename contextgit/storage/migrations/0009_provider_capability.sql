-- 0009_provider_capability.sql
-- What a provider is for: chat completions, web search, or image generation.
-- Search (Tavily) and image (OpenAI Images, local SD) providers are catalog rows
-- too, so they use the same credential store and add-a-provider flow.

ALTER TABLE providers ADD COLUMN capability TEXT NOT NULL DEFAULT 'chat';
