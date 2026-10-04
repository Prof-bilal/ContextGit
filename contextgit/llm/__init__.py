"""LLM adapter layer. Every LLM call goes through a provider, never directly."""

from contextgit.llm.anthropic import AnthropicProvider
from contextgit.llm.base import AsyncLLMProvider, LLMProvider
from contextgit.llm.fake import FakeProvider
from contextgit.llm.images import ImageResult, ImageTransport, MockImages
from contextgit.llm.openai_compatible import OpenAICompatibleProvider
from contextgit.llm.registry import (
    ProviderInfo,
    ResolvedProvider,
    all_provider_infos,
    build_adapter,
    build_for,
    build_images_for,
    build_search_for,
    effective_spec,
    provider_info,
    resolve_provider,
)
from contextgit.llm.search import MockSearch, SearchBackend, SearchResult, TavilySearch
from contextgit.llm.spec import BUILTIN_BY_ID, BUILTIN_PROVIDERS, ProviderSpec

__all__ = [
    "BUILTIN_BY_ID",
    "BUILTIN_PROVIDERS",
    "AnthropicProvider",
    "AsyncLLMProvider",
    "FakeProvider",
    "ImageResult",
    "ImageTransport",
    "LLMProvider",
    "MockImages",
    "MockSearch",
    "OpenAICompatibleProvider",
    "ProviderInfo",
    "ProviderSpec",
    "ResolvedProvider",
    "SearchBackend",
    "SearchResult",
    "TavilySearch",
    "all_provider_infos",
    "build_adapter",
    "build_for",
    "build_images_for",
    "build_search_for",
    "effective_spec",
    "provider_info",
    "resolve_provider",
]
