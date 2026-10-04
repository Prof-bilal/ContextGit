"""Deterministic FakeProvider — required for tests (backend.md).

Never calls a network. Behavior:
- `responses`: mapping from a substring of the last user message to a
  scripted reply; unmatched messages get an echo reply.
- `stream()` yields the reply in fixed-size chunks so consumers can be
  tested against streaming behavior deterministically.
- `count_tokens()` uses the same ~4 chars/token heuristic as core.
"""

from collections.abc import AsyncIterator, Iterator

from contextgit.core.models import Message

_CHARS_PER_TOKEN = 4
_CHUNK = 7  # deliberately not word-aligned to catch chunk-boundary bugs


class FakeProvider:
    """Scripted, deterministic provider for unit and integration tests."""

    def __init__(self, responses: dict[str, str] | None = None, default: str = "ok.") -> None:
        self._responses = responses or {}
        self._default = default
        self.calls: list[list[Message]] = []

    def _reply(self, messages: list[Message]) -> str:
        self.calls.append(list(messages))
        last_user = next((m for m in reversed(messages) if m.role == "user"), None)
        if last_user is None:
            return self._default
        for needle, reply in self._responses.items():
            if needle in last_user.content:
                return reply
        return self._default

    def complete(self, messages: list[Message], **opts: object) -> str:
        return self._reply(messages)

    def stream(self, messages: list[Message], **opts: object) -> Iterator[str]:
        text = self._reply(messages)
        for i in range(0, len(text), _CHUNK):
            yield text[i : i + _CHUNK]

    async def astream(self, messages: list[Message], **opts: object) -> AsyncIterator[str]:
        """Same deterministic chunks, without blocking an event loop."""
        text = self._reply(messages)
        for i in range(0, len(text), _CHUNK):
            yield text[i : i + _CHUNK]

    def count_tokens(self, messages: list[Message]) -> int:
        text = "\n".join(m.content for m in messages)
        return (len(text) + _CHARS_PER_TOKEN - 1) // _CHARS_PER_TOKEN
