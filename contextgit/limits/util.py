"""Shared helpers for the limits adapters."""

import httpx


def error_message(label: str, exc: Exception) -> str:
    """A short, user-facing reason a limits fetch failed (never a raw traceback)."""
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        if status in (401, 403):
            return f"{label} sign-in expired — sign in again."
        return f"Could not reach {label} (HTTP {status})."
    return f"Could not reach {label}."
