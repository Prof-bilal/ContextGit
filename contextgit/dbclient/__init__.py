"""The database client: saved connections, live handles, and their adapters."""

from contextgit.dbclient.adapters import (
    MAX_ROWS,
    Adapter,
    build_adapter,
    driver_hint,
    is_write,
)
from contextgit.dbclient.store import ConnectionRegistry, ConnectionStore, registry

__all__ = [
    "MAX_ROWS",
    "Adapter",
    "ConnectionRegistry",
    "ConnectionStore",
    "build_adapter",
    "driver_hint",
    "is_write",
    "registry",
]
