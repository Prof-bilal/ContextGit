"""Provider contract. A new provider is one new file implementing this."""

from collections.abc import Iterator
from typing import Protocol

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
