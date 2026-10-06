"""The harness → limits-adapter registry, with a short TTL cache.

Limits change slowly, so repeated UI polls reuse a cached result; `refresh=True`
(the panel's Refresh button) bypasses it. Adapters never raise — a failure is a
`HarnessLimits` with a `message`.
"""

import time
from collections.abc import Callable

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

_cache: dict[str, tuple[float, HarnessLimits]] = {}


def all_limits(*, refresh: bool = False) -> list[HarnessLimits]:
    """Limits for every harness with an adapter (cached unless `refresh`)."""
    now = time.monotonic()
    results: list[HarnessLimits] = []
    for harness, label, fetch in ADAPTERS:
        cached = _cache.get(harness)
        if not refresh and cached is not None and now - cached[0] < TTL_SECONDS:
            results.append(cached[1])
            continue
        try:
            value = fetch()
        except Exception as exc:  # noqa: BLE001 - adapters must not raise; be safe
            value = HarnessLimits(
                harness=harness, label=label, signed_in=False, message=str(exc)
            )
        _cache[harness] = (now, value)
        results.append(value)
    return results


def clear_cache() -> None:
    """Drop the cache (used by tests)."""
    _cache.clear()
