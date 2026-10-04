"""Provider registry: resolve a spec + credentials into a working adapter.

The built-in catalog is data (`spec.py`); user rows add a key or a whole custom
endpoint. Credentials are stored locally and never echoed back: the API only
ever sees `has_key` and a short `key_hint`.
"""

import os
from collections.abc import Mapping
from dataclasses import dataclass

from pydantic import BaseModel

from contextgit.core.errors import ProviderConfigError, ProviderNotFound
from contextgit.core.models import (
    AuthStyle,
    ProviderCapability,
    ProviderKind,
    ProviderRecord,
)
from contextgit.llm.anthropic import AnthropicProvider
from contextgit.llm.base import LLMProvider
from contextgit.llm.fake import FakeProvider
from contextgit.llm.images import ImageTransport, LocalSDImages, MockImages, OpenAIImages
from contextgit.llm.openai_compatible import OpenAICompatibleProvider
from contextgit.llm.search import MockSearch, SearchBackend, TavilySearch
from contextgit.llm.spec import BUILTIN_BY_ID, BUILTIN_PROVIDERS, ProviderSpec, env_var

_MOCK_REPLY = (
    "This is the offline mock provider: no key, no network. Add a real provider "
    "(Agnes AI, OpenRouter, Groq, Anthropic, Ollama…) in the add-provider dialog to "
    "talk to a live model. Every reply here is scripted and deterministic."
)


class ProviderInfo(BaseModel):
    """The safe, serializable view of a provider — never carries the key."""

    id: str
    label: str
    vendor: str
    kind: ProviderKind
    capability: ProviderCapability = "chat"
    base_url: str
    auth: AuthStyle
    default_model: str | None = None
    docs_url: str | None = None
    models: list[str] = []
    models_endpoint: bool = True
    requires_key: bool = True
    openai_shaped: bool = True
    templated: bool = False
    is_builtin: bool = True
    has_key: bool = False
    configured: bool = False
    # True when the user stored a row for this provider (a key, or enabling a
    # local server). Distinguishes "ready to use" from "just a catalog entry".
    user_configured: bool = False
    key_hint: str | None = None


@dataclass(frozen=True)
class ResolvedProvider:
    """A provider ready to build: its spec, secret and effective base URL."""

    spec: ProviderSpec
    api_key: str | None
    base_url: str
    model: str | None


def key_hint(key: str | None) -> str | None:
    """A short, non-reversible hint for a stored key: `sk-…AB12`."""
    if not key:
        return None
    if len(key) <= 8:
        return "•" * len(key)
    return f"{key[:3]}…{key[-4:]}"


def _record_for(records: list[ProviderRecord], provider_id: str) -> ProviderRecord | None:
    return next((record for record in records if record.id == provider_id), None)


def effective_spec(record: ProviderRecord) -> ProviderSpec:
    """A user row overlaid on its built-in counterpart (or a custom spec)."""
    base = BUILTIN_BY_ID.get(record.id)
    if base is None:
        return ProviderSpec(
            id=record.id,
            label=record.label,
            vendor=record.vendor,
            kind=record.kind,
            capability=record.capability,
            base_url=record.base_url,
            auth=record.auth_style,
            default_model=record.default_model,
            models=record.models,
        )
    return base.model_copy(
        update={
            "label": record.label or base.label,
            "vendor": record.vendor or base.vendor,
            "kind": record.kind if record.kind != "cloud" else base.kind,
            "capability": record.capability,
            "base_url": record.base_url or base.base_url,
            "auth": record.auth_style,
            "default_model": record.default_model or base.default_model,
            "models": record.models or base.models,
        }
    )


def env_for(
    spec: ProviderSpec, environ: Mapping[str, str] | None = None
) -> tuple[str | None, str, str | None]:
    """Environment fallbacks, so CI needs no DB row: key, base URL, model."""
    env = os.environ if environ is None else environ
    key = env.get(env_var(spec.id, "API_KEY")) or None
    base_url = env.get(env_var(spec.id, "BASE_URL")) or spec.base_url
    model = env.get(env_var(spec.id, "MODEL")) or spec.default_model
    return key, base_url, model


def resolve_provider(
    provider_id: str,
    records: list[ProviderRecord],
    environ: Mapping[str, str] | None = None,
) -> ResolvedProvider:
    """Resolve one provider by id: spec, credential and effective base URL.

    A stored row wins over the environment, which wins over the built-in default.
    """
    record = _record_for(records, provider_id)
    spec = effective_spec(record) if record is not None else BUILTIN_BY_ID.get(provider_id)
    if spec is None:
        raise ProviderNotFound(f"unknown provider '{provider_id}'")
    env_key, env_base, env_model = env_for(spec, environ)
    api_key = (record.api_key if record is not None else None) or env_key
    base_url = (record.base_url if record is not None and record.base_url else env_base)
    model = (
        record.default_model if record is not None and record.default_model else env_model
    )
    if not spec.requires_key and not api_key:
        api_key = "local"  # local servers ignore auth, but the header must be present
    return ResolvedProvider(spec=spec, api_key=api_key, base_url=base_url, model=model)


def build_adapter(
    spec: ProviderSpec, *, api_key: str | None, base_url: str, model: str | None = None
) -> LLMProvider:
    """Instantiate the adapter a spec calls for."""
    if spec.kind == "mock":
        return FakeProvider(default=_MOCK_REPLY)
    if spec.templated and ("{" in base_url or "}" in base_url):
        raise ProviderConfigError(
            f"provider '{spec.id}' needs its base URL filled in ({base_url})"
        )
    if not spec.requires_key and not api_key:
        api_key = "local"
    # Pass "" rather than None: the adapter must not fall back to the global
    # CTX_LLM_API_KEY, which would be the wrong credential for this provider.
    key = api_key or ""
    if not spec.openai_shaped:
        if spec.vendor.lower().startswith("anthropic") or spec.id == "anthropic":
            return AnthropicProvider(api_key=key, base_url=base_url, model=model)
        raise ProviderConfigError(
            f"provider '{spec.id}' is not OpenAI-shaped and has no adapter yet"
        )
    return OpenAICompatibleProvider(
        api_key=key, base_url=base_url, model=model, auth=spec.auth
    )


def build_for(
    provider_id: str,
    records: list[ProviderRecord],
    environ: Mapping[str, str] | None = None,
) -> tuple[LLMProvider, ResolvedProvider]:
    """Resolve and build in one step; the returned resolved config has the model."""
    resolved = resolve_provider(provider_id, records, environ)
    adapter = build_adapter(
        resolved.spec,
        api_key=resolved.api_key,
        base_url=resolved.base_url,
        model=resolved.model,
    )
    return adapter, resolved


def provider_info(
    spec: ProviderSpec,
    record: ProviderRecord | None,
    *,
    environ: Mapping[str, str] | None = None,
    is_builtin: bool,
) -> ProviderInfo:
    """The redacted view of one provider for the picker."""
    env_key, _, _ = env_for(spec, environ)
    stored_key = record.api_key if record is not None else None
    effective_key = stored_key or env_key
    models = (record.models if record is not None and record.models else spec.models)
    has_key = bool(effective_key) or not spec.requires_key
    return ProviderInfo(
        id=spec.id,
        label=spec.label,
        vendor=spec.vendor,
        kind=spec.kind,
        capability=spec.capability,
        base_url=spec.base_url,
        auth=spec.auth,
        default_model=spec.default_model,
        docs_url=spec.docs_url,
        models=models,
        models_endpoint=spec.models_endpoint,
        requires_key=spec.requires_key,
        openai_shaped=spec.openai_shaped,
        templated=spec.templated,
        is_builtin=is_builtin,
        has_key=bool(effective_key),
        configured=has_key,
        user_configured=record is not None,
        key_hint=key_hint(stored_key),
    )


def all_provider_infos(
    records: list[ProviderRecord],
    environ: Mapping[str, str] | None = None,
    capability: ProviderCapability | None = None,
) -> list[ProviderInfo]:
    """Built-in catalog (with overrides applied), then custom providers."""
    infos: list[ProviderInfo] = [
        provider_info(spec, _record_for(records, spec.id), environ=environ, is_builtin=True)
        for spec in BUILTIN_PROVIDERS
    ]
    for record in records:
        if record.id in BUILTIN_BY_ID:
            continue
        infos.append(
            provider_info(effective_spec(record), record, environ=environ, is_builtin=False)
        )
    if capability is not None:
        infos = [info for info in infos if info.capability == capability]
    return infos


def build_search_for(
    provider_id: str,
    records: list[ProviderRecord],
    environ: Mapping[str, str] | None = None,
) -> tuple[SearchBackend, ResolvedProvider]:
    """Resolve and build a search backend by provider id."""
    resolved = resolve_provider(provider_id, records, environ)
    if resolved.spec.capability != "search":
        raise ProviderConfigError(f"provider '{provider_id}' is not a search provider")
    if resolved.spec.kind == "mock":
        return MockSearch(), resolved
    if resolved.spec.id == "tavily":
        return TavilySearch(api_key=resolved.api_key, base_url=resolved.base_url), resolved
    raise ProviderConfigError(f"provider '{provider_id}' has no search adapter")


def build_images_for(
    provider_id: str,
    records: list[ProviderRecord],
    environ: Mapping[str, str] | None = None,
) -> tuple[ImageTransport, ResolvedProvider]:
    """Resolve and build an image backend by provider id."""
    resolved = resolve_provider(provider_id, records, environ)
    if resolved.spec.capability != "image":
        raise ProviderConfigError(f"provider '{provider_id}' is not an image provider")
    if resolved.spec.kind == "mock":
        return MockImages(), resolved
    if resolved.spec.id == "openai-images":
        return OpenAIImages(api_key=resolved.api_key, base_url=resolved.base_url), resolved
    if resolved.spec.id == "local-sd":
        return LocalSDImages(base_url=resolved.base_url), resolved
    raise ProviderConfigError(f"provider '{provider_id}' has no image adapter")
