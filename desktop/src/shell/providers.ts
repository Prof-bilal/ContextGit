/**
 * Provider + model catalog for the workspace, branded the way users know them
 * (Claude, ChatGPT, Codex, Gemini, Grok…) rather than by vendor.
 *
 * UI-side for now: the Chat tab is still fixture-backed, so picking here sets the
 * model the chat will use once that tab is wired to /api/v1/chat/stream.
 *
 * `hue` reuses the existing per-agent colour tokens in shell.css, so the picker
 * adds no new palette entries.
 */
export interface ModelInfo {
  id: string;
  label: string;
  context?: string;
  note?: string;
}

export interface ProviderInfo {
  id: string;
  /** Product name, as users know it. */
  label: string;
  /** Company behind it. */
  vendor: string;
  monogram: string;
  hue: string;
  kind: "cloud" | "local" | "compatible";
  models: ModelInfo[];
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "claude",
    label: "Claude",
    vendor: "Anthropic",
    monogram: "C",
    hue: "claude",
    kind: "cloud",
    models: [
      { id: "fable-5", label: "Claude Fable 5", context: "1M", note: "flagship" },
      { id: "opus-4.8", label: "Claude Opus 4.8", context: "1M" },
      { id: "sonnet-4.6", label: "Claude Sonnet 4.6", context: "1M", note: "balanced" },
      { id: "haiku-4.5", label: "Claude Haiku 4.5", note: "fast, cheap" },
    ],
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    vendor: "OpenAI",
    monogram: "O",
    hue: "codex",
    kind: "cloud",
    models: [
      { id: "gpt-5.5", label: "GPT-5.5", note: "flagship" },
      { id: "gpt-5.2", label: "GPT-5.2", note: "mainline" },
      { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", note: "cheap" },
    ],
  },
  {
    id: "codex",
    label: "Codex",
    vendor: "OpenAI",
    monogram: "X",
    hue: "aider",
    kind: "cloud",
    models: [
      { id: "gpt-5.3-codex", label: "GPT-5.3-Codex", note: "default" },
      { id: "gpt-5.5", label: "GPT-5.5", note: "token-efficient" },
      { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", note: "light tasks" },
    ],
  },
  {
    id: "gemini",
    label: "Gemini",
    vendor: "Google",
    monogram: "G",
    hue: "gemini",
    kind: "cloud",
    models: [
      { id: "gemini-3.1-pro", label: "Gemini 3.1 Pro", context: "200k" },
      { id: "gemini-3-flash", label: "Gemini 3 Flash", note: "budget" },
    ],
  },
  {
    id: "grok",
    label: "Grok",
    vendor: "xAI",
    monogram: "K",
    hue: "shell",
    kind: "cloud",
    models: [
      { id: "grok-4.3", label: "Grok 4.3", context: "1M", note: "flagship" },
      { id: "grok-4.1-fast", label: "Grok 4.1 Fast", context: "2M", note: "cheapest" },
    ],
  },
  {
    id: "opencode",
    label: "OpenCode Zen",
    vendor: "OpenCode",
    monogram: "Z",
    hue: "opencode",
    kind: "cloud",
    models: [
      { id: "mimo-v2.6-flash", label: "MiMo v2.6 Flash", context: "128k", note: "free" },
      { id: "big-pickle", label: "Big Pickle", context: "200k" },
    ],
  },
  {
    id: "local",
    label: "Local",
    vendor: "Ollama",
    monogram: "L",
    hue: "ollama",
    kind: "local",
    models: [
      { id: "qwen3-coder", label: "Qwen3 Coder", context: "256k", note: "on-device" },
      { id: "llama3.3", label: "Llama 3.3 70B", context: "128k", note: "on-device" },
      { id: "deepseek-v3", label: "DeepSeek V3", context: "128k", note: "on-device" },
    ],
  },
  {
    id: "compatible",
    label: "Custom endpoint",
    vendor: "OpenAI-compatible",
    monogram: "E",
    hue: "codex",
    kind: "compatible",
    models: [
      { id: "custom", label: "Custom base URL", note: "CTX_LLM_BASE_URL" },
    ],
  },
];

export interface ModelSelection {
  providerId: string;
  modelId: string;
}

export const DEFAULT_MODEL: ModelSelection = { providerId: "claude", modelId: "sonnet-4.6" };

export function findProvider(providerId: string): ProviderInfo | undefined {
  return PROVIDERS.find((provider) => provider.id === providerId);
}

export function findModel(selection: ModelSelection): ModelInfo | undefined {
  return findProvider(selection.providerId)?.models.find((model) => model.id === selection.modelId);
}
