"""Tests for the AgentEvent envelope and the provider capability registry."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from contextgit.adapters.base import AdapterCapabilities
from contextgit.adapters.registry import get_adapter, known_adapters
from contextgit.core.events import PAYLOAD_VERSION, AgentEvent


class TestAgentEvent:
    def test_envelope_defaults_are_labeled(self) -> None:
        event = AgentEvent(
            id="evt_1",
            aggregate_id="task_1",
            event_type="lifecycle",
            source="terminal",
        )
        assert event.payload_version == PAYLOAD_VERSION
        assert event.capture == "FULL"
        assert event.data_label == "observed"
        assert event.payload == {}
        assert event.timestamp.tzinfo is not None

    def test_correlation_fields_round_trip(self) -> None:
        event = AgentEvent(
            id="evt_2",
            aggregate_id="run_9",
            event_type="usage",
            source="codex",
            correlation_id="corr_1",
            task_id="task_1",
            session_id="sess_1",
            run_id="run_9",
            capture="PARTIAL",
            data_label="reported",
            payload={"input_tokens": 12},
        )
        restored = AgentEvent.model_validate_json(event.model_dump_json())
        assert restored == event

    @pytest.mark.parametrize("bad_kind", ["unknown", "", "TOOL_CALL"])
    def test_unknown_event_kind_is_rejected(self, bad_kind: str) -> None:
        with pytest.raises(ValidationError):
            AgentEvent(id="e", aggregate_id="a", event_type=bad_kind, source="x")  # type: ignore[arg-type]

    def test_unknown_capture_quality_is_rejected(self) -> None:
        with pytest.raises(ValidationError):
            AgentEvent(
                id="e",
                aggregate_id="a",
                event_type="error",
                source="x",
                capture="EXACT",  # type: ignore[arg-type]
            )

    def test_unknown_data_label_is_rejected(self) -> None:
        with pytest.raises(ValidationError):
            AgentEvent(
                id="e",
                aggregate_id="a",
                event_type="usage",
                source="x",
                data_label="exact",  # type: ignore[arg-type]
            )


class TestAdapterRegistry:
    @pytest.mark.parametrize("agent", ["codex", "claude", "opencode", "terminal"])
    def test_core_providers_are_declared_launchable(self, agent: str) -> None:
        adapter = get_adapter(agent)
        assert adapter.id == agent
        assert adapter.capabilities.launch is True

    def test_review_capability_matches_runner_support(self) -> None:
        assert get_adapter("codex").capabilities.structured_review is True
        assert get_adapter("claude").capabilities.structured_review is True
        assert get_adapter("opencode").capabilities.structured_review is False
        assert get_adapter("terminal").capabilities.structured_review is False

    def test_transcript_capability_matches_capture_support(self) -> None:
        assert get_adapter("opencode").capabilities.transcript is True
        assert get_adapter("terminal").capabilities.transcript is False

    def test_unknown_provider_is_unsupported_not_guessed(self) -> None:
        adapter = get_adapter("mystery-agent")
        assert adapter.capabilities == AdapterCapabilities()
        assert adapter.capabilities.launch is False

    def test_missing_agent_id_is_unsupported(self) -> None:
        assert get_adapter(None).capabilities == AdapterCapabilities()

    def test_declared_event_kinds_are_valid_envelope_kinds(self) -> None:
        for adapter in known_adapters():
            for kind in adapter.capabilities.event_kinds:
                AgentEvent(id="e", aggregate_id="a", event_type=kind, source=adapter.id)
