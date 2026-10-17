"""Tests for the canonical Task lifecycle and legacy status projections."""

from __future__ import annotations

import pytest

from contextgit.core.errors import ContextGitError, InvalidTaskTransition
from contextgit.core.lifecycle import (
    PHASES,
    TRANSITIONS,
    agent_run_phase,
    assert_transition,
    can_transition,
    legacy_task_phase,
    phase_to_legacy_task_status,
    session_phase,
)


class TestTransitions:
    def test_happy_path_is_allowed(self) -> None:
        path = ["DRAFT", "READY", "RUNNING", "IMPLEMENTED", "VERIFYING", "READY_TO_MERGE"]
        for src, dst in zip(path, path[1:], strict=False):
            assert can_transition(src, dst), f"{src} -> {dst} should be allowed"
            assert_transition(src, dst)

    @pytest.mark.parametrize(
        ("src", "dst"),
        [
            ("READY", "READY_TO_MERGE"),  # cannot skip running and implementation
            ("RUNNING", "READY_TO_MERGE"),  # must pass through implementation
            ("DRAFT", "RUNNING"),
            ("CANCELLED", "READY"),  # cancelled is terminal
            ("READY_TO_MERGE", "RUNNING"),
        ],
    )
    def test_invalid_moves_are_rejected(self, src: str, dst: str) -> None:
        assert not can_transition(src, dst)
        with pytest.raises(InvalidTaskTransition):
            assert_transition(src, dst)

    def test_unknown_phase_is_rejected_deterministically(self) -> None:
        with pytest.raises(InvalidTaskTransition, match="unknown task phase 'NOPE'"):
            assert_transition("NOPE", "READY")
        with pytest.raises(InvalidTaskTransition, match="unknown task phase 'NOPE'"):
            assert_transition("READY", "NOPE")

    def test_error_is_a_domain_error(self) -> None:
        assert issubclass(InvalidTaskTransition, ContextGitError)

    def test_every_phase_has_a_transition_entry(self) -> None:
        assert set(TRANSITIONS) == set(PHASES)


class TestLegacyTaskProjection:
    @pytest.mark.parametrize(
        ("status", "kwargs", "expected"),
        [
            ("todo", {}, "READY"),
            ("todo", {"blocked": True}, "BLOCKED"),
            ("blocked", {}, "BLOCKED"),
            ("working", {}, "RUNNING"),
            ("review", {}, "IMPLEMENTED"),
            ("review", {"verifying": True}, "VERIFYING"),
            ("done", {}, "READY_TO_MERGE"),
            ("failed", {}, "FAILED"),
        ],
    )
    def test_legacy_status_projects_to_phase(
        self, status: str, kwargs: dict[str, bool], expected: str
    ) -> None:
        assert legacy_task_phase(status, **kwargs) == expected

    def test_unknown_legacy_status_is_rejected(self) -> None:
        with pytest.raises(InvalidTaskTransition):
            legacy_task_phase("bogus")

    def test_reverse_projection_covers_every_phase(self) -> None:
        for phase in PHASES:
            assert phase_to_legacy_task_status(phase) in {
                "todo",
                "blocked",
                "working",
                "review",
                "done",
                "failed",
            }

    def test_reverse_projection_is_lossy_in_documented_places(self) -> None:
        assert phase_to_legacy_task_status("DRAFT") == phase_to_legacy_task_status("READY")
        assert phase_to_legacy_task_status("IMPLEMENTED") == phase_to_legacy_task_status(
            "VERIFYING"
        )
        assert phase_to_legacy_task_status("CANCELLED") == "failed"

    def test_round_trip_preserves_legacy_status_for_non_lossy_phases(self) -> None:
        for legacy in ("blocked", "working", "done", "failed"):
            phase = legacy_task_phase(legacy)
            assert phase_to_legacy_task_status(phase) == legacy

    def test_unknown_phase_reverse_projection_is_rejected(self) -> None:
        with pytest.raises(InvalidTaskTransition):
            phase_to_legacy_task_status("NOPE")


class TestRunAndSessionProjection:
    @pytest.mark.parametrize(
        ("run_status", "expected"),
        [
            ("queued", "READY"),
            ("executing", "RUNNING"),
            ("awaiting_approval", "RUNNING"),
            ("validating", "VERIFYING"),
            ("completed", "IMPLEMENTED"),
            ("failed", "FAILED"),
            ("cancelled", "CANCELLED"),
        ],
    )
    def test_agent_run_statuses(self, run_status: str, expected: str) -> None:
        assert agent_run_phase(run_status) == expected

    @pytest.mark.parametrize(
        ("session_status", "expected"),
        [("idle", "READY"), ("running", "RUNNING"), ("done", "IMPLEMENTED"), ("error", "FAILED")],
    )
    def test_session_statuses(self, session_status: str, expected: str) -> None:
        assert session_phase(session_status) == expected

    def test_unknown_run_and_session_statuses_are_rejected(self) -> None:
        with pytest.raises(InvalidTaskTransition):
            agent_run_phase("nope")
        with pytest.raises(InvalidTaskTransition):
            session_phase("nope")
