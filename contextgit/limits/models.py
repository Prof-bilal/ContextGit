"""Normalized usage-limit shapes for CLI harnesses (Command Code, Cline, …).

Each CLI reports its limits in its own private format; the adapters in this
package map that into these shapes so the UI renders one consistent panel.
Every field is best-effort: a CLI that reports nothing yields a `message`
instead of an error.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from contextgit.core.models import utcnow


class LimitWindow(BaseModel):
    """One rate-limit window (e.g. the 5-hour or weekly meter)."""

    label: str
    used: float
    cap: float
    reset_at: datetime | None = None
    # Credits for Command Code's windows; other CLIs may report tokens.
    unit: str = "credits"


class LimitCredits(BaseModel):
    """Remaining balances, when the CLI reports them."""

    monthly_remaining: float | None = None
    purchased_remaining: float | None = None
    free_remaining: float | None = None
    # Freebuff keeps a separate "wallet" pool from the daily allowance.
    wallet_remaining: float | None = None
    total_remaining: float | None = None
    total_spent: float | None = None


class LimitTotals(BaseModel):
    """Aggregate usage for the current billing period (or lifetime)."""

    total_tokens: float | None = None
    total_cost: float | None = None
    requests: int | None = None
    period: str | None = None


class HarnessLimits(BaseModel):
    """The limits one harness reports, normalized for the Code tab."""

    harness: str
    state: Literal["available", "waiting", "not_signed_in", "unsupported", "error"] | None = None
    scope: Literal["account", "session", "local_project"] = "account"
    session_id: str | None = None
    stale: bool = False
    retry_after_seconds: float | None = None
    label: str
    # True when this package has an adapter for the harness at all.
    supported: bool = True
    # True when the CLI is signed in and returned data.
    signed_in: bool = False
    source: str | None = None
    plan: str | None = None
    windows: list[LimitWindow] = Field(default_factory=list)
    credits: LimitCredits | None = None
    totals: LimitTotals | None = None
    # Human-readable reason the limits are unavailable (not an error to fix).
    message: str | None = None
    fetched_at: datetime = Field(default_factory=utcnow)
