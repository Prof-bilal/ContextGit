"""Canonical Task lifecycle (roadmap Phase 1).

Pure functions only: no storage, no git, no imports from `models`, so both
`models.Task` (for its derived `phase`) and tests can use them without cycles.

The legacy status fields (`TaskStatus`, `AgentRunStatus`, `SessionStatus`)
stay authoritative for storage and existing workflows. This module is the
projection onto the canonical lifecycle plus the rules for moving between
canonical phases. Legacy values are never rewritten by this module.
"""

from __future__ import annotations

from typing import Literal, get_args

from contextgit.core.errors import InvalidTaskTransition

TaskPhase = Literal[
    "DRAFT",
    "READY",
    "RUNNING",
    "IMPLEMENTED",
    "VERIFYING",
    "READY_TO_MERGE",
    "BLOCKED",
    "FAILED",
    "CANCELLED",
]
PHASES: tuple[str, ...] = get_args(TaskPhase)

# Allowed moves. Anything not listed is rejected deterministically.
# IMPLEMENTED -> READY_TO_MERGE is a deliberate shortcut: today a human can
# approve reviewed work without a separate verifier run. Phase 5 will tighten
# this into evidence-based gates.
TRANSITIONS: dict[str, frozenset[str]] = {
    "DRAFT": frozenset({"READY", "CANCELLED"}),
    "READY": frozenset({"RUNNING", "BLOCKED", "CANCELLED"}),
    "BLOCKED": frozenset({"READY", "CANCELLED"}),
    "RUNNING": frozenset({"IMPLEMENTED", "FAILED", "BLOCKED", "CANCELLED"}),
    "IMPLEMENTED": frozenset({"VERIFYING", "READY_TO_MERGE", "RUNNING", "FAILED", "CANCELLED"}),
    "VERIFYING": frozenset({"READY_TO_MERGE", "RUNNING", "FAILED", "BLOCKED", "CANCELLED"}),
    "READY_TO_MERGE": frozenset({"IMPLEMENTED", "CANCELLED"}),
    "FAILED": frozenset({"READY", "CANCELLED"}),
    "CANCELLED": frozenset(),
}

TERMINAL_PHASES: frozenset[str] = frozenset({"CANCELLED"})


def can_transition(current: str, target: str) -> bool:
    """True when `current -> target` is an allowed canonical move."""
    return target in TRANSITIONS.get(current, frozenset())


def assert_transition(current: str, target: str) -> None:
    """Raise `InvalidTaskTransition` unless the move is allowed."""
    if current not in TRANSITIONS:
        raise InvalidTaskTransition(f"unknown task phase '{current}'")
    if target not in TRANSITIONS:
        raise InvalidTaskTransition(f"unknown task phase '{target}'")
    if not can_transition(current, target):
        raise InvalidTaskTransition(f"cannot move a task from {current} to {target}")


# ---------- legacy projections ----------
#
# Team tasks keep their five-value legacy status. Most of the mapping is
# one-to-one; the exceptions are documented in docs/domain-model.md.

LegacyTaskStatus = Literal["todo", "blocked", "working", "review", "done", "failed"]


def legacy_task_phase(
    status: str, *, blocked: bool = False, verifying: bool = False
) -> TaskPhase:
    """Project a legacy team-task status onto the canonical phase.

    `blocked` means unfinished dependencies exist (derived by the graph, never
    stored). `verifying` means an independent verifier run is attached to the
    task while it waits on review.
    """
    if status == "done":
        return "READY_TO_MERGE"
    if status == "failed":
        return "FAILED"
    if status == "working":
        return "RUNNING"
    if status == "review":
        return "VERIFYING" if verifying else "IMPLEMENTED"
    if status == "blocked":
        return "BLOCKED"
    if status == "todo":
        return "BLOCKED" if blocked else "READY"
    raise InvalidTaskTransition(f"unknown legacy task status '{status}'")


def phase_to_legacy_task_status(phase: str) -> LegacyTaskStatus:
    """Project a canonical phase back to the legacy status used by storage.

    Lossy by design: `DRAFT` and `READY` both become `todo`, `IMPLEMENTED` and
    `VERIFYING` both become `review`, and `CANCELLED` becomes `failed`
    because the legacy set has no cancelled value.
    """
    mapping: dict[str, LegacyTaskStatus] = {
        "DRAFT": "todo",
        "READY": "todo",
        "BLOCKED": "blocked",
        "RUNNING": "working",
        "IMPLEMENTED": "review",
        "VERIFYING": "review",
        "READY_TO_MERGE": "done",
        "FAILED": "failed",
        "CANCELLED": "failed",
    }
    if phase not in mapping:
        raise InvalidTaskTransition(f"unknown task phase '{phase}'")
    return mapping[phase]


_AGENT_RUN_PHASES: dict[str, TaskPhase] = {
    "queued": "READY",
    "inspecting": "RUNNING",
    "planning": "RUNNING",
    "awaiting_approval": "RUNNING",
    "executing": "RUNNING",
    "validating": "VERIFYING",
    "ready": "IMPLEMENTED",
    "completed": "IMPLEMENTED",
    "failed": "FAILED",
    "cancelled": "CANCELLED",
}

_SESSION_PHASES: dict[str, TaskPhase] = {
    "idle": "READY",
    "running": "RUNNING",
    "done": "IMPLEMENTED",
    "error": "FAILED",
}


def agent_run_phase(status: str) -> TaskPhase:
    """Canonical phase implied by an AgentRun status (`AgentRunStatus`)."""
    if status not in _AGENT_RUN_PHASES:
        raise InvalidTaskTransition(f"unknown agent run status '{status}'")
    return _AGENT_RUN_PHASES[status]


def session_phase(status: str) -> TaskPhase:
    """Canonical phase implied by a Session status (`SessionStatus`)."""
    if status not in _SESSION_PHASES:
        raise InvalidTaskTransition(f"unknown session status '{status}'")
    return _SESSION_PHASES[status]
