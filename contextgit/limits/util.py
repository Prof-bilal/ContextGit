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


def retry_after(exc: Exception) -> float | None:
    if not isinstance(exc, httpx.HTTPStatusError):
        return None
    header = exc.response.headers.get("retry-after")
    if not header:
        return None
    try:
        return max(0.0, float(header))
    except ValueError:
        from datetime import UTC, datetime
        from email.utils import parsedate_to_datetime

        try:
            return max(0.0, (parsedate_to_datetime(header) - datetime.now(UTC)).total_seconds())
        except (TypeError, ValueError):
            return None
