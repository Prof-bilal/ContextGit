"""CLI-reported integration usage, separate from account allowances."""

from typing import Any

from contextgit.core.models import utcnow


def observation(harness: str, job_id: str, raw: dict[str, Any]) -> dict[str, Any]:
    totals = raw.get("total", raw)
    tokens = totals.get("totalTokens", totals.get("total_tokens"))
    if tokens is None and any(key in totals for key in ("input_tokens", "output_tokens")):
        tokens = sum(
            totals.get(key, 0) or 0
            for key in (
                "input_tokens",
                "output_tokens",
                "cache_read_input_tokens",
                "cache_creation_input_tokens",
            )
        )
    return {
        "harness": harness,
        "label": "Codex" if harness == "codex" else "Claude Code",
        "state": "available",
        "plan": None,
        "scope": "session",
        "session_id": job_id,
        "signed_in": True,
        "supported": True,
        "stale": False,
        "source": f"{harness} structured runner",
        "windows": [],
        "credits": None,
        "totals": {
            "total_tokens": tokens,
            "total_cost": raw.get("total_cost_usd"),
            "requests": None,
            "period": "this review attempt",
        },
        "fetched_at": utcnow().isoformat(),
        "reading": raw,
        "message": "CLI-reported session usage. Account quotas are separate.",
    }
