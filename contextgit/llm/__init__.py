"""LLM adapter layer. Every LLM call goes through a provider, never directly."""

from contextgit.llm.base import LLMProvider
from contextgit.llm.fake import FakeProvider
from contextgit.llm.openai_compatible import OpenAICompatibleProvider

__all__ = ["FakeProvider", "LLMProvider", "OpenAICompatibleProvider"]
