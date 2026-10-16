"""Model context-window metadata and conservative token estimates."""

from dataclasses import dataclass


@dataclass(frozen=True)
class ContextWindow:
    model: str
    limit: int | None
    source: str


_KNOWN: tuple[tuple[str, int], ...] = (
    ("gpt-4.1", 1_047_576), ("gpt-4o", 128_000),
    ("claude-opus-4", 200_000), ("claude-sonnet-4", 200_000),
    ("claude-haiku-4", 200_000), ("gemini-2.5", 1_048_576),
    ("gemini-3", 1_048_576), ("llama3", 128_000),
    ("qwen", 128_000), ("deepseek", 128_000),
)


def context_window(model: str | None) -> ContextWindow:
    value = (model or "").strip()
    lowered = value.lower()
    for prefix, limit in _KNOWN:
        if lowered.startswith(prefix):
            return ContextWindow(value, limit, "built-in model catalog")
    return ContextWindow(value, None, "unknown model")


def estimate_tokens(text: str) -> int:
    return (len(text) + 3) // 4 if text else 0
