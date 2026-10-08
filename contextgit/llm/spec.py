"""The provider catalog: data, not code.

Nearly every provider speaks the same OpenAI protocol, so a new one is a row in
`BUILTIN_PROVIDERS`, not a new class. Only genuinely different shapes (Anthropic)
need a bespoke adapter, and they set `openai_shaped=False`.

`base_url` may contain `{host}` or `{account}` placeholders for self-hosted
gateways; the user supplies the real value in the add-a-provider flow.
"""

from typing import Any

from pydantic import BaseModel, Field

from contextgit.core.models import AuthStyle, ProviderCapability, ProviderKind


class ProviderSpec(BaseModel):
    """One provider: where it is, how it authenticates, and what it models."""

    id: str
    label: str
    vendor: str
    kind: ProviderKind = "cloud"
    capability: ProviderCapability = "chat"
    base_url: str
    auth: AuthStyle = "bearer"
    default_model: str | None = None
    docs_url: str | None = None
    # Fallback catalog when `/models` is unsupported or unreachable.
    models: list[str] = Field(default_factory=list)
    models_endpoint: bool = True
    requires_key: bool = True
    openai_shaped: bool = True
    # True when `base_url` carries a {placeholder} the user must fill in.
    templated: bool = False


def _spec(**kwargs: Any) -> ProviderSpec:
    return ProviderSpec(**kwargs)


BUILTIN_PROVIDERS: list[ProviderSpec] = [
    _spec(
        id="mock",
        label="Mock (offline)",
        vendor="ContextGit",
        kind="mock",
        base_url="mock://local",
        auth="none",
        default_model="mock-1",
        models=["mock-1", "mock-2"],
        models_endpoint=False,
        requires_key=False,
    ),
    # --- the three requested ---
    _spec(
        id="agnes",
        label="Agnes AI",
        vendor="Agnes",
        kind="gateway",
        base_url="https://apihub.agnes-ai.com/v1",
        default_model="agnes-2.5-flash",
        docs_url="https://wiki.agnes-ai.com/en/docs/quickstart",
        models=["agnes-2.5-flash"],
    ),
    _spec(
        id="omniroute",
        label="OmniRoute (self-hosted)",
        vendor="OmniRoute",
        kind="gateway",
        base_url="http://localhost:8000/v1",
        docs_url="https://omni.inamoriyama.com/docs",
        models=[],
    ),
    _spec(
        id="freellm",
        label="FreeLLM gateway (self-hosted)",
        vendor="FreeLLM",
        kind="gateway",
        base_url="http://localhost:3000/v1",
        docs_url="https://freellm.net/providers/",
        models=[],
    ),
    # --- curated direct providers ---
    _spec(
        id="openrouter",
        label="OpenRouter",
        vendor="OpenRouter",
        kind="gateway",
        base_url="https://openrouter.ai/api/v1",
        default_model="openai/gpt-4o-mini",
        docs_url="https://openrouter.ai/docs",
        models=[],
    ),
    _spec(
        id="groq",
        label="Groq",
        vendor="Groq",
        base_url="https://api.groq.com/openai/v1",
        docs_url="https://console.groq.com/docs/openai",
        models=[],
    ),
    _spec(
        id="together",
        label="Together AI",
        vendor="Together",
        base_url="https://api.together.xyz/v1",
        models=[],
    ),
    _spec(
        id="fireworks",
        label="Fireworks AI",
        vendor="Fireworks",
        base_url="https://api.fireworks.ai/inference/v1",
        models=[],
    ),
    _spec(
        id="deepinfra",
        label="DeepInfra",
        vendor="DeepInfra",
        base_url="https://api.deepinfra.com/v1/openai",
        models=[],
    ),
    _spec(
        id="cerebras",
        label="Cerebras",
        vendor="Cerebras",
        base_url="https://api.cerebras.ai/v1",
        models=[],
    ),
    _spec(
        id="mistral",
        label="Mistral",
        vendor="Mistral AI",
        base_url="https://api.mistral.ai/v1",
        models=[],
    ),
    _spec(
        id="xai",
        label="Grok (xAI)",
        vendor="xAI",
        base_url="https://api.x.ai/v1",
        default_model="grok-4",
        models=[],
    ),
    _spec(
        id="deepseek",
        label="DeepSeek",
        vendor="DeepSeek",
        base_url="https://api.deepseek.com/v1",
        default_model="deepseek-chat",
        models=[],
    ),
    _spec(
        id="moonshot",
        label="Moonshot (Kimi)",
        vendor="Moonshot AI",
        base_url="https://api.moonshot.ai/v1",
        models=[],
    ),
    _spec(
        id="zhipu",
        label="Zhipu (GLM)",
        vendor="Zhipu AI",
        base_url="https://open.bigmodel.cn/api/paas/v4",
        models=[],
    ),
    _spec(
        id="perplexity",
        label="Perplexity",
        vendor="Perplexity",
        base_url="https://api.perplexity.ai",
        models=[],
    ),
    # --- also worth a row ---
    _spec(
        id="openai",
        label="OpenAI",
        vendor="OpenAI",
        base_url="https://api.openai.com/v1",
        default_model="gpt-4o-mini",
        docs_url="https://platform.openai.com/docs",
        models=["gpt-4o", "gpt-4o-mini", "gpt-4.1"],
    ),
    _spec(
        id="gemini",
        label="Gemini",
        vendor="Google",
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        default_model="gemini-2.0-flash",
        models=[],
    ),
    _spec(
        id="github-models",
        label="GitHub Models",
        vendor="GitHub",
        base_url="https://models.inference.ai.azure.com",
        models=[],
    ),
    _spec(
        id="novita",
        label="Novita AI",
        vendor="Novita",
        base_url="https://api.novita.ai/v3/openai",
        models=[],
    ),
    _spec(
        id="hyperbolic",
        label="Hyperbolic",
        vendor="Hyperbolic",
        base_url="https://api.hyperbolic.xyz/v1",
        models=[],
    ),
    # --- gateways ---
    _spec(
        id="vercel",
        label="Vercel AI Gateway",
        vendor="Vercel",
        kind="gateway",
        base_url="https://ai-gateway.vercel.sh/v1",
        models=[],
    ),
    _spec(
        id="cloudflare",
        label="Cloudflare AI Gateway",
        vendor="Cloudflare",
        kind="gateway",
        base_url="https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/compat",
        models=[],
        templated=True,
    ),
    _spec(
        id="portkey",
        label="Portkey",
        vendor="Portkey",
        kind="gateway",
        base_url="https://api.portkey.ai/v1",
        models=[],
    ),
    _spec(
        id="helicone",
        label="Helicone",
        vendor="Helicone",
        kind="gateway",
        base_url="https://ai-gateway.helicone.ai/ai",
        models=[],
    ),
    _spec(
        id="requesty",
        label="Requesty",
        vendor="Requesty",
        kind="gateway",
        base_url="https://router.requesty.ai/v1",
        models=[],
    ),
    _spec(
        id="litellm",
        label="LiteLLM (self-hosted)",
        vendor="LiteLLM",
        kind="gateway",
        base_url="http://localhost:4000",
        models=[],
    ),
    # --- local (no key) ---
    _spec(
        id="ollama",
        label="Ollama",
        vendor="Ollama",
        kind="local",
        base_url="http://localhost:11434/v1",
        auth="none",
        requires_key=False,
        models=["qwen2.5-coder", "llama3.2", "deepseek-r1"],
    ),
    _spec(
        id="lmstudio",
        label="LM Studio",
        vendor="LM Studio",
        kind="local",
        base_url="http://localhost:1234/v1",
        auth="none",
        requires_key=False,
        models=["local-model"],
    ),
    _spec(
        id="llamacpp",
        label="llama.cpp",
        vendor="llama.cpp",
        kind="local",
        base_url="http://localhost:8080/v1",
        auth="none",
        requires_key=False,
        models=["local-model"],
    ),
    _spec(
        id="vllm",
        label="vLLM",
        vendor="vLLM",
        kind="local",
        base_url="http://localhost:8000/v1",
        auth="none",
        requires_key=False,
        models=["local-model"],
    ),
    _spec(
        id="localai",
        label="LocalAI",
        vendor="LocalAI",
        kind="local",
        base_url="http://localhost:8080/v1",
        auth="none",
        requires_key=False,
        models=["local-model"],
    ),
    # --- bespoke (non-OpenAI shape) ---
    _spec(
        id="anthropic",
        label="Claude",
        vendor="Anthropic",
        base_url="https://api.anthropic.com/v1",
        auth="x-api-key",
        default_model="claude-sonnet-4-5",
        docs_url="https://docs.anthropic.com",
        models=["claude-opus-4-1", "claude-sonnet-4-5", "claude-haiku-4-5"],
        models_endpoint=False,
        openai_shaped=False,
    ),
    # --- web search (research engine) ---
    _spec(
        id="tavily",
        label="Tavily Search",
        vendor="Tavily",
        capability="search",
        base_url="https://api.tavily.com",
        default_model="basic",
        docs_url="https://docs.tavily.com",
        models=["basic", "advanced"],
        models_endpoint=False,
    ),
    _spec(
        id="mock-search",
        label="Mock search (offline)",
        vendor="ContextGit",
        kind="mock",
        capability="search",
        base_url="mock://search",
        auth="none",
        requires_key=False,
        models_endpoint=False,
    ),
    # --- image generation ---
    _spec(
        id="openai-images",
        label="OpenAI Images",
        vendor="OpenAI",
        capability="image",
        base_url="https://api.openai.com/v1",
        default_model="gpt-image-1",
        docs_url="https://platform.openai.com/docs/guides/image-generation",
        models=["gpt-image-1", "dall-e-3"],
        models_endpoint=False,
    ),
    _spec(
        id="local-sd",
        label="Local SD (AUTOMATIC1111)",
        vendor="Local",
        kind="local",
        capability="image",
        base_url="http://localhost:7860",
        auth="none",
        requires_key=False,
        default_model="sd-model",
        models=["sd-model"],
        models_endpoint=False,
    ),
    _spec(
        id="mock-image",
        label="Mock images (offline)",
        vendor="ContextGit",
        kind="mock",
        capability="image",
        base_url="mock://images",
        auth="none",
        requires_key=False,
        default_model="mock-image-1",
        models=["mock-image-1"],
        models_endpoint=False,
    ),
]

BUILTIN_BY_ID: dict[str, ProviderSpec] = {spec.id: spec for spec in BUILTIN_PROVIDERS}

# Chat mode's closed catalog: exactly these ten providers (plus the offline
# mock) are ever offered. Other built-ins stay in `BUILTIN_PROVIDERS` so saved
# connections and existing conversations still resolve, but they no longer
# appear in the chat picker.
CHAT_PRESET_IDS = (
    "openrouter", "omniroute", "agnes", "openai", "anthropic",
    "gemini", "groq", "freellm", "ollama", "mistral",
)


def env_var(provider_id: str, suffix: str) -> str:
    """`CTX_LLM_<PROVIDER>_<SUFFIX>`, e.g. CTX_LLM_GROQ_API_KEY."""
    token = "".join(char if char.isalnum() else "_" for char in provider_id).upper()
    return f"CTX_LLM_{token}_{suffix}"
