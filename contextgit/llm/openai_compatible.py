"""OpenAI-compatible chat completions adapter (the default for most providers).

Real streaming over httpx: `"stream": true`, read the `data:` lines, yield
deltas, stop at `[DONE]`. Auth is a spec, not a hard-coded Bearer header, so
Groq/OpenRouter/xAI/Azure-style keys all resolve to the same class.
"""

import asyncio
import json
import os
import time
from collections.abc import AsyncIterator, Iterator
from typing import Any

import httpx

from contextgit.core.models import AuthStyle, Message
from contextgit.llm.http_error import (
    ProviderHTTPError,
    describe_payload,
    describe_response,
    retryable,
)


class OpenAICompatibleProvider:
    """Chat-completions adapter for any provider that speaks the OpenAI shape."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        auth: AuthStyle = "bearer",
        timeout: float = 60.0,
        retries: int = 2,
    ) -> None:
        self.api_key = api_key if api_key is not None else os.getenv("CTX_LLM_API_KEY", "")
        resolved = base_url or os.getenv("CTX_LLM_BASE_URL") or "https://api.openai.com/v1"
        self.base_url = resolved.rstrip("/")
        self.model = model or os.getenv("CTX_LLM_MODEL", "gpt-4o-mini")
        self.auth = auth
        self.timeout = timeout
        self.retries = max(0, retries)

    # ---------- request shaping ----------

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self.api_key and self.auth == "bearer":
            headers["Authorization"] = f"Bearer {self.api_key}"
        elif self.api_key and self.auth == "x-api-key":
            headers["x-api-key"] = self.api_key
        elif self.api_key and self.auth == "api-key":
            headers["api-key"] = self.api_key
        return headers

    def _params(self) -> dict[str, str]:
        if self.api_key and self.auth == "query":
            return {"key": self.api_key}
        return {}

    def _payload(
        self, messages: list[Message], *, stream: bool, opts: dict[str, Any]
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
        }
        payload.update(opts)
        if stream:
            payload["stream"] = True
        return payload

    @staticmethod
    def _raise_for_status(response: httpx.Response) -> None:
        if response.status_code >= 400:
            raise ProviderHTTPError(response.status_code, describe_response(response))

    # ---------- completions ----------

    def complete(self, messages: list[Message], **opts: object) -> str:
        """Send messages and return the assistant response text."""
        payload = self._payload(messages, stream=False, opts=dict(opts))
        url = f"{self.base_url}/chat/completions"
        last: Exception | None = None
        for attempt in range(self.retries + 1):
            try:
                with httpx.Client(timeout=self.timeout) as client:
                    response = client.post(
                        url, headers=self._headers(), params=self._params(), json=payload
                    )
                    self._raise_for_status(response)
                    data = response.json()
                choices = data.get("choices") if isinstance(data, dict) else None
                if not choices:
                    # A 200 whose body is not a completion (some gateways return
                    # errors this way); surface the provider's reason, not a KeyError.
                    raise ProviderHTTPError(200, describe_payload(data))
                message = choices[0].get("message") or {}
                return str(message.get("content") or "")
            except Exception as exc:
                last = exc
                if not retryable(exc) or attempt == self.retries:
                    break
                time.sleep(min(0.25 * (2**attempt), 2.0))
        raise RuntimeError(f"LLM request failed: {last}") from last

    def _iter_sse_deltas(self, lines: Iterator[str]) -> Iterator[str]:
        for line in lines:
            line = line.strip()
            if not line or line.startswith(":"):
                continue
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                return
            try:
                event = json.loads(data)
            except ValueError:
                continue
            if isinstance(event, dict) and event.get("error"):
                # Providers stream mid-stream failures as an error frame.
                raise ProviderHTTPError(200, describe_payload(event))
            choices = event.get("choices") or []
            if not choices:
                continue
            delta = choices[0].get("delta") or {}
            text = delta.get("content")
            if text:
                yield text

    def stream(self, messages: list[Message], **opts: object) -> Iterator[str]:
        """Stream the reply chunk by chunk over a real SSE connection."""
        payload = self._payload(messages, stream=True, opts=dict(opts))
        url = f"{self.base_url}/chat/completions"
        try:
            with httpx.Client(timeout=self.timeout) as client:
                with client.stream(
                    "POST", url, headers=self._headers(), params=self._params(), json=payload
                ) as response:
                    self._raise_for_status(response)
                    yield from self._iter_sse_deltas(response.iter_lines())
        except Exception as exc:
            raise RuntimeError(f"LLM stream failed: {exc}") from exc

    async def astream(self, messages: list[Message], **opts: object) -> AsyncIterator[str]:
        """Async streaming for the SSE route (never blocks the event loop)."""
        payload = self._payload(messages, stream=True, opts=dict(opts))
        url = f"{self.base_url}/chat/completions"
        # Retry only the connection setup, never mid-stream (deltas may already be sent).
        for attempt in range(self.retries + 1):
            sent = False
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    async with client.stream(
                        "POST", url, headers=self._headers(), params=self._params(), json=payload
                    ) as response:
                        self._raise_for_status(response)
                        async for line in response.aiter_lines():
                            for delta in self._iter_sse_deltas(iter([line])):
                                sent = True
                                yield delta
                return
            except Exception as exc:
                if sent or not retryable(exc) or attempt == self.retries:
                    raise RuntimeError(f"LLM stream failed: {exc}") from exc
                await asyncio.sleep(min(0.25 * (2**attempt), 2.0))

    def list_models(self) -> list[str]:
        """`GET {base}/models` — discovered once, then cached by the caller."""
        with httpx.Client(timeout=self.timeout) as client:
            response = client.get(
                f"{self.base_url}/models", headers=self._headers(), params=self._params()
            )
            self._raise_for_status(response)
            data = response.json()
        entries = data.get("data") if isinstance(data, dict) else data
        models: list[str] = []
        for entry in entries or []:
            if isinstance(entry, str):
                models.append(entry)
            elif isinstance(entry, dict) and entry.get("id"):
                models.append(str(entry["id"]))
        return sorted(set(models))

    def count_tokens(self, messages: list[Message]) -> int:
        """Provider-independent rough estimate (~4 chars per token)."""
        text = "\n".join(message.content for message in messages)
        return (len(text) + 3) // 4
