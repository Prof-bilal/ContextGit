"""LLM adapter layer. Every LLM call goes through a provider, never directly."""

from contextgit.llm.base import LLMProvider
from contextgit.llm.fake import FakeProvider

__all__ = ["FakeProvider", "LLMProvider"]
