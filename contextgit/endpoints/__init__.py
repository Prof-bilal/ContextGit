"""The endpoint graph: what a project exposes, and why it exists."""

from contextgit.endpoints.discover import discover, from_openapi, load_openapi
from contextgit.endpoints.provenance import endpoint_provenance, graph_with_provenance
from contextgit.endpoints.serve import (
    ServerSupervisor,
    detect_run_command,
    fetch_live_openapi,
    supervisor,
)
from contextgit.endpoints.tests import (
    TestStore,
    discover_test_files,
    generate_for_endpoint,
    remembered,
    run_suite,
    test_path_for,
)
from contextgit.endpoints.why import reasoning_for, why_for, why_history

__all__ = [
    "ServerSupervisor",
    "TestStore",
    "detect_run_command",
    "discover",
    "discover_test_files",
    "endpoint_provenance",
    "fetch_live_openapi",
    "from_openapi",
    "generate_for_endpoint",
    "graph_with_provenance",
    "load_openapi",
    "reasoning_for",
    "remembered",
    "run_suite",
    "supervisor",
    "test_path_for",
    "why_for",
    "why_history",
]
