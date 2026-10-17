"""Provider-neutral agent event envelope (roadmap Phase 0 + Phase 1).

Every provider (Codex, Claude, OpenCode, terminal, ...) maps its own output
into this one shape. Provider-specific details go in `payload`, and the
envelope fields stay stable so later systems (provenance, review evidence,
analytics) can rely on them.

This module only defines the contract. Nothing is persisted or emitted yet.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field

# What happened.
AgentEventKind = Literal[
    "lifecycle",
    "message",
    "tool_call",
    "command",
    "file",
    "usage",
    "model",
    "status",
    "error",
]

# How much of the real activity was captured (Phase 4 quality labels).
CaptureQuality = Literal["FULL", "PARTIAL", "ESTIMATED", "UNAVAILABLE"]

# Where a value came from: reported by the provider, observed by ContextGit,
# or estimated locally. Token counts must carry one of these labels.
DataLabel = Literal["reported", "observed", "estimated"]

# Bump when a payload shape changes incompatibly.
PAYLOAD_VERSION = 1


def _now() -> datetime:
    return datetime.now(UTC)


class AgentEvent(BaseModel):
    """One normalized event from an agent run.

    `aggregate_id` names the thing the event is about (a task or run id), and
    `correlation_id` links every event produced by one invocation.
    """

    id: str
    aggregate_id: str
    event_type: AgentEventKind
    timestamp: datetime = Field(default_factory=_now)
    source: str  # provider id, e.g. "codex", "claude", "terminal"
    payload_version: int = PAYLOAD_VERSION
    correlation_id: str | None = None
    task_id: str | None = None
    session_id: str | None = None
    run_id: str | None = None
    capture: CaptureQuality = "FULL"
    data_label: DataLabel = "observed"
    payload: dict[str, object] = Field(default_factory=dict)
