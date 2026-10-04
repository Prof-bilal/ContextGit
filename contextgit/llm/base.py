"""Provider contract. A new provider is one new file implementing this."""

from collections.abc import AsyncIterator, Iterator
from typing import Protocol, runtime_checkable

from contextgit.core.models import Message


class LLMProvider(Protocol):
    """The only interface through which LLMs are called."""

    def complete(self, messages: list[Message], **opts: object) -> str:
        """One-shot completion."""
        ...

    def stream(self, messages: list[Message], **opts: object) -> Iterator[str]:
        """Stream the reply token by token (chunk by chunk)."""
        ...

    def count_tokens(self, messages: list[Message]) -> int:
        """Provider token count for these messages."""
        ...


@runtime_checkable
class AsyncLLMProvider(Protocol):
    """Optional upgrade: stream without blocking the event loop.

    Providers that can do real network streaming implement this alongside
    `LLMProvider`; the chat route prefers it when present and falls back to
    the synchronous `stream()` otherwise.
    """

    def astream(self, messages: list[Message], **opts: object) -> AsyncIterator[str]:
        """Yield reply chunks asynchronously."""
        ...
