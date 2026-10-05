"""Anthropic adapter — the OpenAI shape does not apply.

`x-api-key` + `anthropic-version`, a top-level `system` string, and a
`/messages` endpoint whose SSE stream uses `content_block_delta` events.
"""

import asyncio
import json
import os
import time
from collections.abc import AsyncIterator, Iterator
from typing import Any

import httpx

from contextgit.core.models import Message
from contextgit.llm.http_error import (
    ProviderHTTPError,
    describe_payload,
    describe_response,
    retryable,
)

_ANTHROPIC_VERSION = "2023-06-01"


class AnthropicProvider:
    """Messages API adapter for Anthropic (Claude)."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        timeout: float = 60.0,
        retries: int = 2,
    ) -> None:
        self.api_key = api_key if api_key is not None else os.getenv("CTX_LLM_API_KEY", "")
        resolved = base_url or os.getenv("CTX_LLM_BASE_URL") or "https://api.anthropic.com/v1"
        self.base_url = resolved.rstrip("/")
        self.model = model or os.getenv("CTX_LLM_MODEL", "claude-sonnet-4-5")
        self.timeout = timeout
        self.retries = max(0, retries)

    def _headers(self) -> dict[str, str]:
        return {
            "x-api-key": self.api_key,
            "anthropic-version": _ANTHROPIC_VERSION,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def _payload(
        self, messages: list[Message], *, stream: bool, opts: dict[str, Any]
    ) -> dict[str, Any]:
        system = "\n".join(m.content for m in messages if m.role == "system")
        turns = [
            {"role": "assistant" if m.role == "assistant" else "user", "content": m.content}
            for m in messages
            if m.role != "system"
        ]
        payload: dict[str, Any] = {
            "model": self.model,
            "max_tokens": opts.pop("max_tokens", 1024),
            "messages": turns,
        }
        if system:
            payload["system"] = system
        payload.update(opts)
        if stream:
            payload["stream"] = True
        return payload

    @staticmethod
    def _raise_for_status(response: httpx.Response) -> None:
        if response.status_code >= 400:
            raise ProviderHTTPError(response.status_code, describe_response(response))

    @staticmethod
    def _text_from(data: dict[str, Any]) -> str:
        if data.get("error"):
            raise ProviderHTTPError(200, describe_payload(data))
        blocks = data.get("content") or []
        return "".join(str(block.get("text", "")) for block in blocks if isinstance(block, dict))

    def complete(self, messages: list[Message], **opts: object) -> str:
        payload = self._payload(messages, stream=False, opts=dict(opts))
        url = f"{self.base_url}/messages"
        last: Exception | None = None
        for attempt in range(self.retries + 1):
            try:
                with httpx.Client(timeout=self.timeout) as client:
                    response = client.post(url, headers=self._headers(), json=payload)
                    self._raise_for_status(response)
                    data = response.json()
                return self._text_from(data)
            except Exception as exc:
                last = exc
                if not retryable(exc) or attempt == self.retries:
                    break
                time.sleep(min(0.25 * (2**attempt), 2.0))
        raise RuntimeError(f"LLM request failed: {last}") from last

    @staticmethod
    def _delta_from(line: str) -> str | None:
        line = line.strip()
        if not line.startswith("data:"):
            return None
        try:
            event = json.loads(line[5:].strip())
        except ValueError:
            return None
        if event.get("type") == "error":
            raise ProviderHTTPError(200, describe_payload(event.get("error") or event))
        if event.get("type") == "content_block_delta":
            delta = event.get("delta") or {}
            text = delta.get("text")
            if text:
                return str(text)
        return None

    def stream(self, messages: list[Message], **opts: object) -> Iterator[str]:
        payload = self._payload(messages, stream=True, opts=dict(opts))
        url = f"{self.base_url}/messages"
        try:
            with httpx.Client(timeout=self.timeout) as client:
                with client.stream("POST", url, headers=self._headers(), json=payload) as response:
                    self._raise_for_status(response)
                    for line in response.iter_lines():
                        text = self._delta_from(line)
                        if text:
                            yield text
        except Exception as exc:
            raise RuntimeError(f"LLM stream failed: {exc}") from exc

    async def astream(self, messages: list[Message], **opts: object) -> AsyncIterator[str]:
        payload = self._payload(messages, stream=True, opts=dict(opts))
        url = f"{self.base_url}/messages"
        for attempt in range(self.retries + 1):
            sent = False
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    async with client.stream(
                        "POST", url, headers=self._headers(), json=payload
                    ) as response:
                        self._raise_for_status(response)
                        async for line in response.aiter_lines():
                            text = self._delta_from(line)
                            if text:
                                sent = True
                                yield text
                return
            except Exception as exc:
                if sent or not retryable(exc) or attempt == self.retries:
                    raise RuntimeError(f"LLM stream failed: {exc}") from exc
                await asyncio.sleep(min(0.25 * (2**attempt), 2.0))

    def count_tokens(self, messages: list[Message]) -> int:
        text = "\n".join(message.content for message in messages)
        return (len(text) + 3) // 4
