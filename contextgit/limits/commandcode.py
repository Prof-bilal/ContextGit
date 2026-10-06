"""Command Code (`cmd`) usage limits.

Command Code shows its limits only inside its own TUI; this adapter makes the
same read-only calls the CLI does, using the API key it already stored at
`~/.commandcode/auth.json`. Endpoints (discovered from the CLI bundle):

  GET /alpha/billing/credits       -> 5-hour / weekly windows + credit balances
  GET /alpha/usage/summary         -> billing-period totals (tokens, cost)
  GET /alpha/billing/subscriptions -> plan id / status

Undocumented and can change; every failure degrades to a `message`.
"""

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from contextgit.limits.models import HarnessLimits, LimitCredits, LimitTotals, LimitWindow
from contextgit.limits.util import error_message

BASE_URL = "https://api.commandcode.ai"
DEFAULT_AUTH_PATH = Path.home() / ".commandcode" / "auth.json"
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


def _int(value: object) -> int | None:
    number = _num(value)
    return int(number) if number is not None else None


def _reset_at(value: object) -> datetime | None:
    """Epoch-milliseconds (or seconds) to an aware datetime."""
    num = _num(value)
    if num is None or num <= 0:
        return None
    seconds = num / 1000 if num > 1e11 else num
    try:
        return datetime.fromtimestamp(seconds, tz=UTC)
    except (OverflowError, OSError, ValueError):
        return None


def _auth_token(auth_path: Path) -> str | None:
    try:
        data = json.loads(auth_path.read_text("utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    token = data.get("apiKey")
    return token if isinstance(token, str) and token else None


def _get(client: httpx.Client, token: str, path: str) -> Any:
    response = client.get(
        f"{BASE_URL}{path}",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    return response.json()


def fetch_limits(
    *,
    auth_path: Path | None = None,
    client: httpx.Client | None = None,
) -> HarnessLimits:
    """Read Command Code's limits. Never raises; failures become `message`."""
    result = HarnessLimits(harness="commandcode", label="Command Code", source="commandcode")
    token = _auth_token(auth_path or DEFAULT_AUTH_PATH)
    if not token:
        result.message = "Sign in to Command Code to see limits (run `command-code`)."
        return result
    result.signed_in = True

    owned = client is None
    http = client or httpx.Client()
    try:
        credits = _get(http, token, "/alpha/billing/credits")
        summary = _get(http, token, "/alpha/usage/summary")
        subscription = _get(http, token, "/alpha/billing/subscriptions")
    except Exception as exc:  # noqa: BLE001 - surface any failure as a message
        result.signed_in = False
        result.message = error_message("Command Code", exc)
        return result
    finally:
        if owned:
            http.close()

    credits = credits if isinstance(credits, dict) else {}
    summary = summary if isinstance(summary, dict) else {}
    subscription = subscription if isinstance(subscription, dict) else {}

    windows: list[LimitWindow] = []
    window_limits = credits.get("windowLimits")
    window_limits = window_limits if isinstance(window_limits, dict) else {}
    for key, label in (("fiveHour", "5-hour"), ("weekly", "Weekly")):
        entry = window_limits.get(key)
        if isinstance(entry, dict):
            windows.append(
                LimitWindow(
                    label=label,
                    used=_num(entry.get("used")) or 0.0,
                    cap=_num(entry.get("cap")) or 0.0,
                    reset_at=_reset_at(entry.get("resetAt")),
                    unit="credits",
                )
            )
    result.windows = windows

    balances = credits.get("credits")
    balances = balances if isinstance(balances, dict) else {}
    monthly = _num(balances.get("monthlyCredits"))
    purchased = _num(balances.get("purchasedCredits"))
    free = _num(balances.get("freeCredits"))
    parts = [value for value in (monthly, purchased, free) if value is not None]
    result.credits = LimitCredits(
        monthly_remaining=monthly,
        purchased_remaining=purchased,
        free_remaining=free,
        total_remaining=sum(parts) if parts else None,
        total_spent=_num(summary.get("totalCost")),
    )

    data = subscription.get("data")
    if isinstance(data, dict) and isinstance(data.get("planId"), str):
        result.plan = data["planId"]

    result.totals = LimitTotals(
        total_tokens=_num(summary.get("totalTokens")),
        total_cost=_num(summary.get("totalCost")),
        requests=_int(summary.get("totalCount")),
        period=summary.get("periodBasis") if isinstance(summary.get("periodBasis"), str) else None,
    )
    if not result.windows and result.credits.total_remaining is None:
        result.message = "Command Code reported no limits."
    return result
