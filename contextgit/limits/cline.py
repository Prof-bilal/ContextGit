"""Cline CLI usage limits (best-effort).

Cline shows credits/plan inside its own TUI, fetched from `api.cline.bot` with
the OAuth access token it stored at `~/.cline/data/settings/providers.json`.
That response format is undocumented, so this adapter maps the fields it
recognises and otherwise degrades to a `message` — including when the OAuth
token has expired (refresh needs a client secret we deliberately don't hold).
"""

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from contextgit.limits.models import HarnessLimits, LimitCredits
from contextgit.limits.util import error_message, retry_after

BASE_URL = "https://api.cline.bot"
DEFAULT_AUTH_PATH = Path.home() / ".cline" / "data" / "settings" / "providers.json"
TIMEOUT = 10.0


def _num(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _auth(auth_path: Path) -> tuple[str | None, float | None]:
    try:
        data = json.loads(auth_path.read_text("utf-8"))
    except (OSError, ValueError):
        return None, None
    if not isinstance(data, dict):
        return None, None
    providers = data.get("providers")
    cline = providers.get("cline") if isinstance(providers, dict) else None
    settings = cline.get("settings") if isinstance(cline, dict) else None
    auth = settings.get("auth") if isinstance(settings, dict) else None
    if not isinstance(auth, dict):
        return None, None
    token = auth.get("accessToken")
    expires = auth.get("expiresAt")
    return (
        token if isinstance(token, str) and token else None,
        float(expires) if isinstance(expires, (int, float)) else None,
    )


def _get(client: httpx.Client, token: str, path: str) -> Any:
    response = client.get(
        f"{BASE_URL}{path}",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    return response.json()


def _first_str(data: dict[str, Any], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = data.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def _first_number(data: dict[str, Any], keys: tuple[str, ...]) -> float | None:
    """Return the first present numeric value, preserving a real zero."""
    for key in keys:
        if key in data:
            value = _num(data[key])
            if value is not None:
                return value
    return None


def _credits_from(data: dict[str, Any]) -> LimitCredits | None:
    """Best-effort credit balances from a nested `credits`/`balance` object."""
    for key in ("credits", "balance", "creditBalance"):
        node = data.get(key)
        if isinstance(node, dict):
            monthly = _first_number(node, ("monthlyRemaining", "monthly"))
            purchased = _first_number(node, ("purchasedRemaining", "purchased"))
            free = _first_number(node, ("freeRemaining", "free"))
            total = _first_number(node, ("totalRemaining", "remaining", "balance"))
            parts = [v for v in (monthly, purchased, free) if v is not None]
            if total is None and parts:
                total = sum(parts)
            if any(v is not None for v in (monthly, purchased, free, total)):
                return LimitCredits(
                    monthly_remaining=monthly,
                    purchased_remaining=purchased,
                    free_remaining=free,
                    total_remaining=total,
                )
    return None


def fetch_limits(
    *,
    auth_path: Path | None = None,
    client: httpx.Client | None = None,
    now: datetime | None = None,
) -> HarnessLimits:
    """Read Cline's limits. Never raises; failures become `message`."""
    result = HarnessLimits(harness="cline", label="Cline", source="cline")
    token, expires = _auth(auth_path or DEFAULT_AUTH_PATH)
    if not token:
        result.message = "Sign in to Cline to see limits (run `cline auth`)."
        return result
    current = now or datetime.now(UTC)
    if expires is not None and current.timestamp() * 1000 >= expires:
        result.message = "Cline sign-in expired — run `cline auth` again."
        return result
    result.signed_in = True

    owned = client is None
    http = client or httpx.Client()
    try:
        plan = _get(http, token, "/api/v1/users/me/plan")
        account = _get(http, token, "/api/v1/users/active-account")
    except Exception as exc:  # noqa: BLE001 - surface any failure as a message
        result.signed_in = False
        result.message = error_message("Cline", exc)
        result.state = "not_signed_in" if "sign-in expired" in (result.message or "") else "error"
        result.retry_after_seconds = retry_after(exc)
        return result
    finally:
        if owned:
            http.close()

    plan_data = plan if isinstance(plan, dict) else {}
    account_data = account if isinstance(account, dict) else {}
    result.plan = _first_str(plan_data, ("planName", "name", "plan", "id")) or _first_str(
        account_data, ("planName", "name")
    )
    result.credits = _credits_from(plan_data) or _credits_from(account_data)
    if result.plan is None and result.credits is None:
        result.message = "Cline reported no limits."
    return result
