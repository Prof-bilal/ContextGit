"""Shared HTTP error handling for provider adapters.

Turns a provider's error body into a readable message instead of a KeyError, so a
bad key or an unknown model says why rather than "LLM request failed: 'choices'".
"""

from typing import Any

import httpx

_RETRYABLE_STATUS = {408, 409, 429}


class ProviderHTTPError(Exception):
    """A provider returned an error response (or a body we cannot use)."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


def describe_payload(data: Any) -> str:
    """Pull the human-readable reason out of a provider's JSON body."""
    if isinstance(data, dict):
        error = data.get("error")
        if isinstance(error, dict) and error.get("message"):
            return str(error["message"])
        if isinstance(error, str):
            return error
        for key in ("message", "detail", "msg"):
            if data.get(key):
                return str(data[key])
        if "choices" not in data:
            return f"unexpected response without 'choices': {str(data)[:300]}"
    return str(data)[:300]


def describe_response(response: httpx.Response) -> str:
    """A one-line reason for a non-2xx response."""
    try:
        body: Any = response.json()
    except ValueError:
        text = response.text[:300].strip()
        return f"HTTP {response.status_code}: {text or '(empty body)'}"
    return f"HTTP {response.status_code}: {describe_payload(body)}"


def retryable(exc: Exception) -> bool:
    """Only transient failures are retried; 4xx is surfaced immediately."""
    if isinstance(exc, (httpx.TransportError, httpx.TimeoutException)):
        return True
    if isinstance(exc, ProviderHTTPError):
        return exc.status in _RETRYABLE_STATUS or exc.status >= 500
    return False
