"""Per-harness usage limits: adapters parse each CLI's own API and fail soft.

No network: an httpx MockTransport stands in for the vendor APIs, and the auth
files are written into a temp directory.
"""

import json
from collections.abc import Callable
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from contextgit.api.app import create_app
from contextgit.core.repo import Repo
from contextgit.limits import registry
from contextgit.limits.cline import fetch_limits as fetch_cline
from contextgit.limits.commandcode import fetch_limits as fetch_commandcode
from contextgit.limits.freebuff import fetch_limits as fetch_freebuff
from contextgit.limits.models import HarnessLimits

Handler = Callable[[httpx.Request], httpx.Response]

CMD_CREDITS = {
    "credits": {
        "belowThreshold": False,
        "creditThreshold": 0,
        "monthlyCredits": 15.79,
        "purchasedCredits": 0,
        "freeCredits": 0,
    },
    "windowLimits": {
        "limited": True,
        "exceeded": None,
        "fiveHour": {"used": 2.25, "cap": 14, "exceeded": False, "resetAt": 1791274176559},
        "weekly": {"used": 7.32, "cap": 35, "exceeded": False, "resetAt": 1791713866526},
    },
}
CMD_SUMMARY = {
    "totalCount": 6897,
    "totalCost": 58.99,
    "totalTokensIn": 1342259032,
    "totalTokensOut": 5493766,
    "totalTokens": 1347752798,
    "periodBasis": "billing-period",
}
CMD_SUBSCRIPTION = {
    "success": True,
    "data": {"id": "sub_1", "status": "active", "planId": "individual-goat"},
}


def _client(handler: Handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def _cmd_auth(tmp_path: Path) -> Path:
    path = tmp_path / "auth.json"
    path.write_text(json.dumps({"apiKey": "sk-test"}), "utf-8")
    return path


def test_commandcode_maps_windows_credits_and_totals(tmp_path: Path) -> None:
    payloads = {
        "/alpha/billing/credits": CMD_CREDITS,
        "/alpha/usage/summary": CMD_SUMMARY,
        "/alpha/billing/subscriptions": CMD_SUBSCRIPTION,
    }

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer sk-test"
        return httpx.Response(200, json=payloads[request.url.path])

    result = fetch_commandcode(auth_path=_cmd_auth(tmp_path), client=_client(handler))

    assert result.signed_in is True
    assert result.plan == "individual-goat"
    assert [window.label for window in result.windows] == ["5-hour", "Weekly"]
    five_hour = result.windows[0]
    assert (five_hour.used, five_hour.cap) == (2.25, 14.0)
    assert five_hour.reset_at is not None
    assert result.credits is not None
    assert result.credits.monthly_remaining == 15.79
    assert result.totals is not None
    assert result.totals.total_tokens == 1347752798


def test_commandcode_without_auth_is_soft(tmp_path: Path) -> None:
    result = fetch_commandcode(
        auth_path=tmp_path / "missing.json",
        client=_client(lambda request: httpx.Response(500)),
    )
    assert result.signed_in is False
    assert result.message is not None and "Sign in" in result.message


def test_commandcode_http_error_is_soft(tmp_path: Path) -> None:
    result = fetch_commandcode(
        auth_path=_cmd_auth(tmp_path),
        client=_client(lambda request: httpx.Response(503)),
    )
    assert result.signed_in is False
    assert result.message is not None and "Could not reach" in result.message


def test_cline_expired_token_is_soft(tmp_path: Path) -> None:
    path = tmp_path / "providers.json"
    path.write_text(
        json.dumps(
            {
                "providers": {
                    "cline": {"settings": {"auth": {"accessToken": "t", "expiresAt": 1000}}}
                }
            }
        ),
        "utf-8",
    )
    result = fetch_cline(auth_path=path, client=_client(lambda request: httpx.Response(401)))
    assert result.signed_in is False
    assert result.message is not None and "expired" in result.message.lower()


def test_cline_missing_token_is_soft(tmp_path: Path) -> None:
    result = fetch_cline(
        auth_path=tmp_path / "none.json",
        client=_client(lambda request: httpx.Response(401)),
    )
    assert result.signed_in is False
    assert result.message is not None


FREEBUFF_SESSION = {
    "status": "none",
    "accessTier": "limited",
    "freebucks": {
        "balance": 440,
        "daily": {
            "limit": 120,
            "streakBonus": 15,
            "spent": 10,
            "remaining": 110,
            "resetAt": "2026-10-06T19:00:00.000Z",
        },
        "wallet": {"balance": 330, "monthlyBonus": 300},
        "planId": "starter",
    },
}


def test_freebuff_maps_freebucks() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer tok"
        assert request.url.path == "/api/v1/freebuff/session"
        return httpx.Response(200, json=FREEBUFF_SESSION)

    result = fetch_freebuff(client=_client(handler), secret="tok")

    assert result.signed_in is True
    assert result.plan == "starter"
    assert [window.label for window in result.windows] == ["Daily"]
    daily = result.windows[0]
    assert (daily.used, daily.cap) == (10.0, 120.0)
    assert daily.unit == "freebucks"
    assert result.credits is not None
    assert result.credits.total_remaining == 440
    assert result.credits.wallet_remaining == 330


def test_freebuff_without_keychain_is_soft() -> None:
    result = fetch_freebuff(client=_client(lambda request: httpx.Response(500)), secret="")
    assert result.signed_in is False
    assert result.message is not None


def test_freebuff_expired_token_is_soft() -> None:
    result = fetch_freebuff(client=_client(lambda request: httpx.Response(401)), secret="tok")
    assert result.signed_in is False
    assert result.message is not None and "login" in result.message


def test_registry_caches_until_refresh(monkeypatch: pytest.MonkeyPatch) -> None:
    registry.clear_cache()
    calls = {"n": 0}

    def fake_fetch() -> HarnessLimits:
        calls["n"] += 1
        return HarnessLimits(harness="commandcode", label="Command Code", signed_in=True)

    monkeypatch.setattr(registry, "ADAPTERS", [("commandcode", "Command Code", fake_fetch)])

    registry.all_limits()
    registry.all_limits()
    assert calls["n"] == 1  # second call served from the cache
    registry.all_limits(refresh=True)
    assert calls["n"] == 2
    registry.clear_cache()


def test_limits_endpoint(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = Repo.init(tmp_path / "repo")
    monkeypatch.setattr(
        "contextgit.api.app.all_limits",
        lambda refresh=False: [
            HarnessLimits(harness="commandcode", label="Command Code", signed_in=False, message="x")
        ],
    )
    client = TestClient(create_app(repo=repo))
    payload = client.get("/api/v1/limits").json()
    assert payload[0]["harness"] == "commandcode"
    assert payload[0]["message"] == "x"


def test_limits_registry_covers_every_desktop_harness(monkeypatch: pytest.MonkeyPatch) -> None:
    import re

    source = (Path(__file__).parents[1] / "desktop/shared/harnesses.ts").read_text()
    expected = set(re.findall(r'id: "([a-z]+)"', source))
    monkeypatch.setattr(
        registry,
        "ADAPTERS",
        [
            (
                harness,
                label,
                lambda harness=harness, label=label: HarnessLimits(harness=harness, label=label),
            )
            for harness, label, _ in registry.ADAPTERS
        ],
    )
    registry.clear_cache()
    results = registry.all_limits()
    assert {value.harness for value in results} == expected
    assert len(results) == len(expected)
    registry.clear_cache()
