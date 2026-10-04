# Chat & research — Round 2: the provider layer

> Research for the provider registry, the add-a-provider flow, and the catalog we
> should ship. Companion: `chat-research-landscape.md`. Verified 2026-10-04.

## Where the repo stands today

| Concern | Today | File |
|---|---|---|
| Interface | `LLMProvider` protocol: `complete`, `stream`, `count_tokens` | `llm/base.py:10-22` |
| Deterministic stub | `FakeProvider` (scripted replies, never touches the network) | `llm/fake.py` |
| Real adapter | `OpenAICompatibleProvider` — `urllib`, **Bearer only**, `{base_url}/chat/completions`, retries on every `HTTPError` including 4xx | `llm/openai_compatible.py` |
| Streaming | **Fake**: it calls `complete()` then re-chunks the finished string at 64 chars | `llm/openai_compatible.py:71-75` |
| Selection | One module-global provider, chosen by `bool(CTX_LLM_API_KEY)`; no registry, no per-request provider | `api/app.py:79-81` |
| Config | `CTX_LLM_API_KEY`, `CTX_LLM_BASE_URL`, `CTX_LLM_MODEL`; no `.env` loading anywhere | `llm/openai_compatible.py:20-23` |
| Model list | UI-only, hand-maintained, 8 vendors | `desktop/src/shell/providers.ts:30-131` |
| Token counts | `len(text)//4` heuristic even though the protocol says "provider token count" | `llm/*.py` |

Two consequences worth stating plainly: **adding a provider today means writing a
class**, and **the model picker does not configure the backend** (the request
carries only a `model` string).

## Target: a registry, not a class per provider

Nearly everything on the list speaks the same protocol, so the registry should be
data, not code:

```python
class ProviderSpec(BaseModel):
    id: str                      # "agnes", "omniroute", "groq", …
    label: str                   # display
    vendor: str                  # grouping
    kind: Literal["cloud", "gateway", "local", "mock"]
    base_url: str                # may be templated: "{host}"
    auth: AuthStyle              # bearer | x-api-key | api-key | query | none
    default_model: str | None
    docs_url: str | None
    models: list[str]            # fallback catalog when /models is unsupported
    models_endpoint: bool        # does GET {base}/models work?
    requires_key: bool
    openai_shaped: bool          # false → needs a bespoke adapter (Anthropic, Azure)
```

- **Registry** = a built-in list of `ProviderSpec`s + user-added ones, resolved by
  id. `OpenAICompatibleProvider` becomes the *default* adapter taking a
  `ProviderSpec`; only genuinely non-OpenAI shapes need a second adapter.
- **Per-request provider**: add `provider` to `ChatRequest`/`CompareRequest`
  (schemas today carry only `model`), and resolve `spec → adapter(credentials)`.
- **Auth styles**: `bearer` (`Authorization: Bearer …`), `x-api-key`
  (+`anthropic-version`, path `/messages`), `api-key` (+`api-version` + deployment
  path, Azure), `query` (`?key=…`), `none` (local). Today the adapter is
  Bearer-only with a hard-coded path, so Anthropic/Azure need real work.
- **Model discovery**: `GET {base_url}/models` when `models_endpoint`, else the
  static `models` list; the desktop catalog is then *generated* from the registry
  instead of hand-maintained.

## Credentials: local, minimal, never echoed

The key must stay on the machine and never reach the renderer:

- New table `providers(id, label, vendor, kind, base_url, auth_style, api_key,
  default_model, models_json, created_at, updated_at)`; `api_key` may be NULL when
  the provider is keyless (local) or reads an env var instead.
- **Env fallback wins for CI**: `CTX_LLM_<PROVIDER>_API_KEY` / `_BASE_URL` /
  `_MODEL`, so a headless run needs no DB row.
- The API **never returns the key** — `GET /providers` returns `has_key: bool`,
  `key_hint: "sk-…AB12"` at most. Redact keys in every error path.
- The localhost API is unauthenticated (an existing, documented caveat), so
  credential routes stay localhost-bound and must not be exposed.

## The add-a-provider flow (the "mock complete" flow)

Four steps, each verifiable, and the whole thing drivable with a **mock** provider
so it works offline:

1. **Add** — `POST /api/v1/providers` `{id?, label, base_url, auth_style, api_key?,
   default_model?}`. Built-ins can be enabled by id instead of typed in.
2. **Test connection** — `POST /api/v1/providers/{id}/test`: one tiny completion
   (`"ping"`, `max_tokens: 1`) → `{ok, latency_ms, model, error?}`. A wrong base
   URL or key fails here, not mid-conversation. This is also what validates the
   conventional defaults in the table below.
3. **Fetch models** — `POST /api/v1/providers/{id}/models`: `GET {base}/models`
   with the configured auth, falling back to the static list; persists
   `models_json` so the picker is populated from one source of truth.
4. **Use** — the picker sends `{provider, model}`; the chat route resolves the
   spec and streams.

**Mock provider** — `kind: "mock"` wraps the existing `FakeProvider`: it needs no
key, always "connects", and returns a scripted model list. That makes the entire
add → test → models → chat flow demonstrable and testable end-to-end with no
network, and it is the fallback when no provider is configured (as today).

## The catalog

### The three requested

| Provider | Base URL | Auth | Notes |
|---|---|---|---|
| **Agnes AI** | `https://apihub.agnes-ai.com/v1` ✅ verified | Bearer | OpenAI-compatible gateway, omni-modal (text/image/video), free credits, streaming + tool calling. Models like `agnes-2.5-flash`; catalog at `github.com/AgnesAI-Labs/AgnesAI-Models`, docs `wiki.agnes-ai.com`. Explicitly tuned for agentic deep-research — a strong default for the research modes. |
| **OmniRoute** | `https://<host>/v1` (self-hosted) ✅ verified | Bearer (key from its dashboard) | MIT, self-hosted TypeScript AI gateway: `npx omniroute`, then **Endpoint → Registered Keys** for a key, OAuth or API key per upstream provider. Model ids are **provider-prefixed** (`gh/gpt-5.1-codex`). `/v1` covers chat/responses/embeddings/images/audio/video/search/moderation, and it exposes MCP + A2A. Needs a **`{host}` template** in `base_url` and a "self-hosted" marker in the UI. |
| **FreeLLM** | *not one endpoint* ⚠ | varies | "FreeLLM" is a **directory** (freellm.net, `awesome-freellm-apis`) plus several **self-hosted community gateways** (`free-llm-gateway`, `freellm-api`, …) that stack free tiers behind one `/v1`. So we should ship it as **two presets** — "FreeLLM gateway (self-hosted)" with a `{host}` URL, and "FreeLLM directory" as reference/docs — rather than pretending it is a hosted API with a key. |

### Curated direct providers (the "+12")

| Provider | Base URL | Auth | Verified here? |
|---|---|---|---|
| OpenRouter | `https://openrouter.ai/api/v1` | Bearer | ✅ |
| Groq | `https://api.groq.com/openai/v1` | Bearer | ⚠ confirm via Test |
| Together AI | `https://api.together.xyz/v1` | Bearer | ⚠ |
| Fireworks AI | `https://api.fireworks.ai/inference/v1` | Bearer | ⚠ |
| DeepInfra | `https://api.deepinfra.com/v1/openai` | Bearer | ⚠ |
| Cerebras | `https://api.cerebras.ai/v1` | Bearer | ⚠ |
| Mistral | `https://api.mistral.ai/v1` | Bearer | ⚠ |
| xAI (Grok) | `https://api.x.ai/v1` | Bearer | ⚠ |
| DeepSeek | `https://api.deepseek.com/v1` | Bearer | ⚠ |
| Moonshot (Kimi) | `https://api.moonshot.ai/v1` | Bearer | ⚠ |
| Zhipu (GLM) | `https://open.bigmodel.cn/api/paas/v4` | Bearer | ⚠ |
| Perplexity | `https://api.perplexity.ai` | Bearer | ⚠ |

⚠ = conventional default from the ecosystem, **not** re-verified in this research;
the app's own *Test connection* / *Fetch models* step is what confirms it, which is
the point of building those two calls first.

### Gateways (verified base URLs)

| Gateway | Base URL | Notes |
|---|---|---|
| OpenRouter | `https://openrouter.ai/api/v1` | ~5.5% markup, largest catalog |
| Vercel AI Gateway | `https://ai-gateway.vercel.sh/v1` | 0% markup |
| Cloudflare AI Gateway | `https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/compat` | 0%, caching + logs |
| Portkey | `https://api.portkey.ai/v1` | free tier, guardrails |
| Helicone | `https://ai-gateway.helicone.ai/ai` | 0%, observability |
| Requesty | `https://router.requesty.ai/v1` | ~5% |
| LiteLLM | `http://localhost:4000` | self-hosted, $0 |

### Local (no key, `kind: "local"`)

Ollama `http://localhost:11434/v1` · LM Studio `http://localhost:1234/v1` ·
llama.cpp `http://localhost:8080/v1` · vLLM `http://localhost:8000/v1` ·
LocalAI `http://localhost:8080/v1` — all OpenAI-shaped, so they are registry rows,
not code. Local providers are also what makes a **private research** mode honest.

### Also worth a row (OpenAI-shaped, not in the curated 12)

OpenAI `https://api.openai.com/v1`, Google Gemini
`https://generativelanguage.googleapis.com/v1beta/openai/`, GitHub Models
`https://models.inference.ai.azure.com`, Novita `https://api.novita.ai/v3/openai`,
Hyperbolic `https://api.hyperbolic.xyz/v1`. Two that are **not** OpenAI-shaped and
therefore need a bespoke adapter when added: **Anthropic**
(`https://api.anthropic.com/v1/messages`, `x-api-key` + `anthropic-version`) and
**Azure OpenAI** (`api-key` + `api-version` + a deployment path).

## Real streaming, properly

The current `stream()` is a lie. Real streaming is: `"stream": true`, read the
`data:` lines, yield deltas, stop at `[DONE]`, honour client aborts, and surface
mid-stream errors as SSE events (the transport already emits `token`/`done`/
`error`; `lib/api.ts` already parses exactly those three). It also requires an
**async** HTTP client (`httpx` is already installed) because the current
`urllib` call blocks the event loop for the whole generation inside an async
handler.

## Sources

- [Agnes AI quickstart (base URL, auth, model)](https://wiki.agnes-ai.com/en/docs/quickstart)
- [Agnes AI docs overview (OpenAI compatibility)](https://wiki.agnes-ai.com/en/docs/overview)
- [AgnesAI-Models gateway + catalog](https://github.com/AgnesAI-Labs/AgnesAI-Models)
- [OmniRoute docs / quick start](https://omni.inamoriyama.com/docs)
- [OmniRoute API reference (GitHub wiki)](https://github.com/diegosouzapw/OmniRoute/wiki/API-Reference)
- [OmniRoute setup guide (npm/Docker, Claude Code + Codex)](https://www.ngjoo.com/en/trending/projects/omniroute/guide/)
- [OmniRoute: routing, setup and risks](https://agentpedia.codes/blog/omniroute-ai-gateway-routing-setup-guide)
- [freellm.net providers directory](https://freellm.net/providers/)
- [awesome-freellm-apis (134+ free LLM APIs)](https://github.com/open-free-llm-api/awesome-freellm-apis)
- [free-llm-gateway: 24+ providers behind one endpoint](https://github.com/MrFadiAi/free-llm-gateway)
- [freellm-api: OpenAI-compatible proxy pooling 16 free tiers](https://github.com/HelenaJohns/freellm-api)
- [OpenAI-compatible base_url cheat sheet (verified June 2026)](https://gist.github.com/cuihuan/a788509111b2324a324ed042cc790179)
- [OpenAI SDK compatible providers 2026 (complete list)](https://aipower.me/blog/openai-sdk-compatible-api-providers)
- [Groq OpenAI compatibility docs](https://console.groq.com/docs/openai)
