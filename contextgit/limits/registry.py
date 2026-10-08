"""The harness → limits-adapter registry, with a short TTL cache.

Limits change slowly, so repeated UI polls reuse a cached result; `refresh=True`
(the panel's Refresh button) bypasses it. Adapters never raise — a failure is a
`HarnessLimits` with a `message`.
"""

import threading
import time
from collections.abc import Callable
from concurrent.futures import Future

from contextgit.limits.cline import fetch_limits as fetch_cline
from contextgit.limits.commandcode import fetch_limits as fetch_commandcode
from contextgit.limits.freebuff import fetch_limits as fetch_freebuff
from contextgit.limits.models import HarnessLimits

TTL_SECONDS = 300.0

Adapter = Callable[..., HarnessLimits]

ADAPTERS: list[tuple[str, str, Adapter]] = [
    ("commandcode", "Command Code", fetch_commandcode),
    ("cline", "Cline", fetch_cline),
    ("freebuff", "Freebuff", fetch_freebuff),
]

_guard = threading.Lock()
_inflight: dict[str, Future[HarnessLimits]] = {}
_failures: dict[str, tuple[int, float]] = {}

_cache: dict[str, tuple[float, HarnessLimits]] = {}


def all_limits(*, refresh: bool = False, harness: str | None = None) -> list[HarnessLimits]:
    """Limits for every harness with an adapter (cached unless `refresh`)."""
    results: list[HarnessLimits] = []
    for name, label, fetch in ADAPTERS:
        if harness and name != harness:
            continue
        results.append(_read(name, label, fetch, refresh, 30.0 if harness else TTL_SECONDS))
    # Desktop collectors supplement these explicit capability states.
    for name, label in [
        ("claude", "Claude Code"),
        ("codex", "Codex"),
        ("opencode", "OpenCode"),
        ("gemini", "Gemini CLI"),
        ("aider", "Aider"),
        ("ollama", "Ollama"),
        ("shell", "Shell"),
        ("pi", "Pi"),
        ("kilo", "Kilo Code"),
    ]:
        if harness and name != harness:
            continue
        results.append(
            HarnessLimits(
                harness=name,
                label=label,
                supported=False,
                state="unsupported",
                message="Desktop usage is available through the CLI collector."
                if name != "shell"
                else "Usage tracking does not apply to a plain shell.",
            )
        )
    return results


def clear_cache() -> None:
    """Drop the cache (used by tests)."""
    with _guard:
        _cache.clear()
        _failures.clear()


def _read(name: str, label: str, fetch: Adapter, refresh: bool, ttl: float) -> HarnessLimits:
    now = time.monotonic()
    with _guard:
        cached = _cache.get(name)
        failure = _failures.get(name)
        if not refresh and cached and ((failure and now < failure[1]) or now - cached[0] < ttl):
            return cached[1]
        future = _inflight.get(name)
        owner = future is None
        if future is None:
            future = Future()
            _inflight[name] = future
    if not owner:
        return future.result()
    try:
        try:
            value = fetch()
        except Exception:
            value = HarnessLimits(
                harness=name, label=label, state="error", message=f"Could not read {label} limits."
            )
        value.source = f"{value.source or label} · polled account reading"
        failed = value.state == "error" or (
            not value.signed_in
            and value.message
            and any(
                term in value.message.lower()
                for term in ("could not", "timed out", "rate", "failed")
            )
        )
        with _guard:
            if failed:
                count = (_failures.get(name, (0, 0))[0]) + 1
                delay = max(min(300, 30 * 2 ** min(count - 1, 4)), value.retry_after_seconds or 0)
                _failures[name] = (count, time.monotonic() + delay)
                if cached and cached[1].signed_in:
                    value = cached[1].model_copy(update={"stale": True, "message": value.message})
            else:
                _failures.pop(name, None)
            _cache[name] = (time.monotonic(), value)
        future.set_result(value)
        return value
    finally:
        with _guard:
            _inflight.pop(name, None)
