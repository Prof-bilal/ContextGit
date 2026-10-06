"""Provider contract. A new provider is one new file implementing this."""

from collections.abc import AsyncIterator, Callable, Iterator
from typing import Protocol, runtime_checkable

from contextgit.core.models import Message

# Adapters call this with `(prompt_tokens, completion_tokens)` when the provider
# returns a real usage frame. Callers pass one to `complete`/`stream`/`astream`
# to capture real usage; adapters that don't report usage simply never call it.
UsageSink = Callable[[int, int], None]


class LLMProvider(Protocol):
    """The only interface through which LLMs are called.

    `usage_sink`, when provided, receives real `(prompt, completion)` token counts
    if the provider reports them; adapters that don't report usage never call it.
    """

    def complete(
        self, messages: list[Message], *, usage_sink: UsageSink | None = None, **opts: object
    ) -> str:
        """One-shot completion."""
        ...

    def stream(
        self, messages: list[Message], *, usage_sink: UsageSink | None = None, **opts: object
    ) -> Iterator[str]:
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

    def astream(
        self, messages: list[Message], *, usage_sink: UsageSink | None = None, **opts: object
    ) -> AsyncIterator[str]:
        """Yield reply chunks asynchronously."""
        ...
