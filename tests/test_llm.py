"""FakeProvider behavior tests (deterministic, no network)."""

from contextgit.core.models import Message
from contextgit.llm import FakeProvider


def msgs(*contents: str) -> list[Message]:
    roles = ("user", "assistant", "user", "assistant", "user", "assistant", "user", "assistant", "user")
    return [Message(role=roles[i % len(roles)], content=c) for i, c in enumerate(contents)]


class TestComplete:
    def test_scripted_response_by_substring(self) -> None:
        p = FakeProvider({"rate limiter": "use a token bucket"})
        reply = p.complete(msgs("design a rate limiter please"))
        assert reply == "use a token bucket"

    def test_fallback_default(self) -> None:
        p = FakeProvider(default="ok.")
        assert p.complete(msgs("unrelated")) == "ok."

    def test_records_calls(self) -> None:
        p = FakeProvider()
        p.complete(msgs("one"))
        p.complete(msgs("two"))
        assert len(p.calls) == 2
        assert p.calls[0][0].content == "one"


class TestStream:
    def test_stream_yields_chunks_concatenating_to_reply(self) -> None:
        p = FakeProvider({"q": "a deterministic reply"}, )
        chunks = list(p.stream(msgs("q")))
        assert "".join(chunks) == "a deterministic reply"
        assert len(chunks) > 1  # actually chunked

    def test_stream_is_deterministic(self) -> None:
        p = FakeProvider({"q": "same every time"})
        assert list(p.stream(msgs("q"))) == list(p.stream(msgs("q")))


class TestCountTokens:
    def test_empty_is_zero(self) -> None:
        assert FakeProvider().count_tokens([]) == 0

    def test_rough_chars_per_token(self) -> None:
        p = FakeProvider()
        n = p.count_tokens([Message(role="user", content="x" * 40)])
        assert n == 10
