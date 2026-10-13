from contextgit.limits.codex import fetch_limits, normalize_limits


def test_codex_windows_use_reported_duration_and_used_percentage():
    value = normalize_limits({"rateLimitsByLimitId": {"codex": {"planType": "plus", "primary": {"usedPercent": 25, "windowDurationMins": 300, "resetsAt": 1800000000}, "secondary": {"usedPercent": 71, "windowDurationMins": 10080}}}})
    assert value.state == "available"
    assert value.plan == "plus"
    assert [(window.label, window.used, window.cap) for window in value.windows] == [("5-hour", 25, 100), ("Weekly", 71, 100)]
    assert value.windows[0].reset_at.timestamp() == 1800000000
    assert value.windows[1].reset_at is None


def test_missing_codex_windows_are_not_zero_usage():
    value = normalize_limits({"rateLimits": {"primary": None, "secondary": None}})
    assert value.windows == []
    assert value.message


def test_multi_bucket_is_preferred_over_legacy():
    value = normalize_limits({"rateLimits": {"primary": {"usedPercent": 99}}, "rateLimitsByLimitId": {"codex": {"primary": {"usedPercent": 12, "windowDurationMins": 10080}}}})
    assert value.windows[0].used == 12
    assert value.windows[0].label == "Weekly"


def test_missing_cli_returns_actionable_state(monkeypatch):
    monkeypatch.setattr("contextgit.limits.codex.codex_executable", lambda: None)
    assert fetch_limits().state == "unsupported"
