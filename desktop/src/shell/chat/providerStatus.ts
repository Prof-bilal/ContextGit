import type { ProviderCapability, ProviderInfo } from "@/lib/api";

/**
 * A provider is ready to run when it is genuinely usable: a real key for a
 * cloud/gateway provider, or a local server the user has explicitly enabled.
 * Bare catalog rows and the offline mocks are not ready, so the UI can ask for
 * a key instead of silently falling back.
 */
export function isReady(provider: ProviderInfo): boolean {
  if (provider.kind === "mock") return false;
  if (provider.kind === "local") return provider.user_configured;
  return provider.has_key;
}

/** Providers worth offering first, per capability. */
export const RECOMMENDED: Record<ProviderCapability, string[]> = {
  chat: ["agnes", "openrouter", "groq", "anthropic", "openai"],
  image: ["openai-images", "local-sd"],
  search: ["tavily"],
};
