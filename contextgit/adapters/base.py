"""Agent adapter contract (roadmap Phase 1).

An adapter describes what one provider can do. Provider-specific behavior
stays inside adapters, and the core domain only reads capability flags. A
capability that is missing is reported as missing, never guessed.

Declarations are descriptive. They say what the current code path already
supports and do not start any process.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from contextgit.core.events import AgentEventKind


@dataclass(frozen=True)
class AdapterCapabilities:
    """What a provider can do today. The default is "nothing known"."""

    # Can start a session inside a ContextGit worktree.
    launch: bool = False
    # Writes a transcript that ContextGit can capture and export.
    transcript: bool = False
    # Reports token usage in-band (provider-reported labels).
    usage: bool = False
    # Can run a read-only structured review with a JSON verdict.
    structured_review: bool = False
    # Normalized event kinds this provider can emit, at any capture quality.
    event_kinds: frozenset[AgentEventKind] = field(default_factory=frozenset)


class AgentAdapter(Protocol):
    """Identity and declared capabilities for one provider."""

    id: str
    label: str
    capabilities: AdapterCapabilities
