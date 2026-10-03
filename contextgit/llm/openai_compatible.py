"""OpenAI-compatible chat completions adapter using only the standard library."""

import json
import os
import time
from collections.abc import Iterator
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from contextgit.core.models import Message


class OpenAICompatibleProvider:
    """Chat-completions adapter configured by CTX_LLM_* environment variables."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        timeout: float = 30.0,
        retries: int = 2,
    ) -> None:
        self.api_key = api_key if api_key is not None else os.getenv("CTX_LLM_API_KEY", "")
        resolved_base_url = base_url or os.getenv("CTX_LLM_BASE_URL") or "https://api.openai.com/v1"
        self.base_url = resolved_base_url.rstrip("/")
        self.model = model or os.getenv("CTX_LLM_MODEL", "gpt-4o-mini")
        self.timeout = timeout
        self.retries = max(0, retries)

    def complete(self, messages: list[Message], **opts: object) -> str:
        """Send messages and return the assistant response text."""
        if not self.api_key:
            raise RuntimeError("CTX_LLM_API_KEY is required for the configured LLM provider")
        payload: dict[str, object] = {
            "model": self.model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
        }
        payload.update(opts)
        body = json.dumps(payload).encode("utf-8")
        for attempt in range(self.retries + 1):
            request = Request(
                f"{self.base_url}/chat/completions",
                data=body,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            try:
                with urlopen(request, timeout=self.timeout) as response:
                    data = json.loads(response.read().decode("utf-8"))
                return str(data["choices"][0]["message"]["content"])
            except (
                HTTPError,
                URLError,
                TimeoutError,
                OSError,
                ValueError,
                KeyError,
                IndexError,
            ) as exc:
                if attempt == self.retries:
                    raise RuntimeError(f"LLM request failed: {exc}") from exc
                time.sleep(min(0.25 * (2**attempt), 2.0))
        raise RuntimeError("LLM request failed")

    def stream(self, messages: list[Message], **opts: object) -> Iterator[str]:
        """Yield the completed response in chunks (the merge path is one-shot)."""
        text = self.complete(messages, **opts)
        for offset in range(0, len(text), 64):
            yield text[offset : offset + 64]

    def count_tokens(self, messages: list[Message]) -> int:
        """Return the project's provider-independent rough token estimate."""
        text = "\n".join(message.content for message in messages)
        return (len(text) + 3) // 4
