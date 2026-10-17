"""Provider capability registry (roadmap Phase 1).

Declarations match what the current code paths already do:
- codex / claude: launchable sessions and read-only structured review
  (see `integration/runners.py`, `CLIRunner`).
- opencode: launchable sessions with transcript capture
  (see `integration/capture.py`, `TranscriptService`).
- terminal: launchable generic sessions with no transcript or review.

Unknown providers get an empty capability set so the UI can show them as
unsupported without guessing.
"""

from __future__ import annotations

from dataclasses import dataclass

from contextgit.adapters.base import AdapterCapabilities


@dataclass(frozen=True)
class ProviderAdapter:
    id: str
    label: str
    capabilities: AdapterCapabilities


_REGISTRY: dict[str, ProviderAdapter] = {
    adapter.id: adapter
    for adapter in (
        ProviderAdapter(
            id="codex",
            label="Codex",
            capabilities=AdapterCapabilities(
                launch=True,
                structured_review=True,
                event_kinds=frozenset({"lifecycle"}),
            ),
        ),
        ProviderAdapter(
            id="claude",
            label="Claude Code",
            capabilities=AdapterCapabilities(
                launch=True,
                structured_review=True,
                event_kinds=frozenset({"lifecycle"}),
            ),
        ),
        ProviderAdapter(
            id="opencode",
            label="OpenCode",
            capabilities=AdapterCapabilities(
                launch=True,
                transcript=True,
                event_kinds=frozenset({"lifecycle", "message"}),
            ),
        ),
        ProviderAdapter(
            id="terminal",
            label="Terminal",
            capabilities=AdapterCapabilities(
                launch=True,
                event_kinds=frozenset({"lifecycle"}),
            ),
        ),
    )
}


def get_adapter(agent_id: str | None) -> ProviderAdapter:
    """Return the adapter for `agent_id`, or an empty, unsupported one."""
    if agent_id and agent_id in _REGISTRY:
        return _REGISTRY[agent_id]
    return ProviderAdapter(
        id=agent_id or "unknown",
        label=agent_id or "Unknown",
        capabilities=AdapterCapabilities(),
    )


def known_adapters() -> list[ProviderAdapter]:
    """All registered adapters, in declaration order."""
    return list(_REGISTRY.values())
