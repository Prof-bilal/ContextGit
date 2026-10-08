"""Freebuff Freebucks balance.

Freebuff is the ad-funded free coding agent; usage is paid in **Freebucks** — a
daily allowance plus a wallet. Its TUI shows the balance it fetches from
`GET {app}/api/v1/freebuff/session`. The auth token is not on disk: the CLI
stores it in the OS keychain, so we read it there (libsecret on Linux, the
Keychain on macOS) and make the same read-only call. Failures degrade to a
`message`.
"""

import shutil
import subprocess
import sys
from datetime import datetime
from typing import Any

import httpx

from contextgit.limits.models import HarnessLimits, LimitCredits, LimitWindow
from contextgit.limits.util import error_message, retry_after

# The API host (freebuff.com is the marketing site; the API lives on codebuff).
BASE_URLS = ("https://www.codebuff.com", "https://codebuff.com")
KEYCHAIN_SERVICE = "freebuff-cli"
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


def _iso(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _keychain_secret() -> str | None:
    """The Freebuff auth token from the OS keychain, or None."""
    if sys.platform == "darwin":
        command = ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"]
    elif sys.platform.startswith("linux"):
        if shutil.which("secret-tool") is None:
            return None
        command = ["secret-tool", "lookup", "service", KEYCHAIN_SERVICE]
    else:
        return None
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return None
    token = result.stdout.strip()
    return token or None


def fetch_limits(
    *,
    client: httpx.Client | None = None,
    secret: str | None = None,
) -> HarnessLimits:
    """Read Freebuff's Freebucks balance. Never raises; failures become `message`."""
    result = HarnessLimits(harness="freebuff", label="Freebuff", source="freebuff")
    token = secret if secret is not None else _keychain_secret()
    if not token:
        result.message = "Sign in to Freebuff to see Freebucks (run `freebuff login`)."
        return result
    result.signed_in = True

    owned = client is None
    http = client or httpx.Client()
    data: dict[str, Any] | None = None
    last_error: Exception | None = None
    try:
        for base in BASE_URLS:
            try:
                response = http.get(
                    f"{base}/api/v1/freebuff/session",
                    headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
                    timeout=TIMEOUT,
                )
                if response.status_code == 401:
                    result.signed_in = False
                    result.message = "Freebuff sign-in expired — run `freebuff login` again."
                    return result
                response.raise_for_status()
                payload = response.json()
                if isinstance(payload, dict):
                    data = payload
                    break
            except Exception as exc:  # noqa: BLE001 - try the next host
                last_error = exc
    finally:
        if owned:
            http.close()

    if data is None:
        result.signed_in = False
        result.message = error_message("Freebuff", last_error or RuntimeError("no response"))
        result.state = "not_signed_in" if "sign-in expired" in (result.message or "") else "error"
        result.retry_after_seconds = retry_after(last_error or RuntimeError("no response"))
        return result

    freebucks = data.get("freebucks")
    if not isinstance(freebucks, dict):
        result.signed_in = False
        result.message = "Freebuff reported no Freebucks balance."
        return result

    daily = freebucks.get("daily")
    daily = daily if isinstance(daily, dict) else {}
    wallet = freebucks.get("wallet")
    wallet = wallet if isinstance(wallet, dict) else {}
    if daily:
        result.windows = [
            LimitWindow(
                label="Daily",
                used=_num(daily.get("spent")) or 0.0,
                cap=_num(daily.get("limit")) or 0.0,
                reset_at=_iso(daily.get("resetAt")),
                unit="freebucks",
            )
        ]
    balance = _num(freebucks.get("balance"))
    wallet_balance = _num(wallet.get("balance"))
    if balance is not None or wallet_balance is not None:
        result.credits = LimitCredits(
            total_remaining=balance,
            wallet_remaining=wallet_balance,
        )
    plan = freebucks.get("planId")
    result.plan = plan if isinstance(plan, str) else None
    return result
