"""Saved database connections, and the live ones behind them.

Two separate things on purpose:

* **Specs** (engine, host, database, user …) are files in `<repo>/db/`, so a
  connection is shareable and versionable — exactly like an API collection.
* **Passwords are never stored here.** They arrive with the request that opens
  the connection, live in memory with the driver handle, and die with it.

Live handles live in a registry keyed by an id, because a database connection is
a stateful resource the UI must be able to reuse and close.
"""

from __future__ import annotations

import re
import threading
from pathlib import Path
from uuid import uuid4

from contextgit.core.errors import DbConnectionNotFound, DbError
from contextgit.core.models import DbConnectionInfo, DbConnectionSpec
from contextgit.dbclient.adapters import Adapter, build_adapter

_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$")


class ConnectionStore:
    """Read/write the repo's `db/` directory of connection specs."""

    def __init__(self, root: Path | str) -> None:
        self._dir = Path(root) / "db"

    def _path(self, name: str) -> Path:
        if not _NAME.fullmatch(name or ""):
            raise DbError("invalid connection name (letters, digits, . _ - and spaces only)")
        return self._dir / f"{name}.json"

    def list(self) -> list[str]:
        if not self._dir.exists():
            return []
        return sorted(path.stem for path in self._dir.glob("*.json"))

    def get(self, name: str) -> DbConnectionSpec:
        path = self._path(name)
        if not path.exists():
            raise DbError(f"no saved connection called {name!r}")
        return DbConnectionSpec.model_validate_json(path.read_text("utf-8"))

    def save(self, spec: DbConnectionSpec) -> DbConnectionSpec:
        self._dir.mkdir(parents=True, exist_ok=True)
        self._path(spec.name).write_text(spec.model_dump_json(indent=2) + "\n", "utf-8")
        return spec

    def delete(self, name: str) -> bool:
        path = self._path(name)
        if not path.exists():
            return False
        path.unlink()
        return True


class ConnectionRegistry:
    """The live connections the UI is holding open."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._live: dict[str, Adapter] = {}

    def open(self, spec: DbConnectionSpec, password: str | None = None) -> DbConnectionInfo:
        adapter = build_adapter(spec, password)
        adapter.connect()
        identifier = uuid4().hex
        with self._lock:
            self._live[identifier] = adapter
        return DbConnectionInfo(
            id=identifier,
            name=spec.name,
            engine=spec.engine,
            server_version=adapter.server_version,
            database=spec.database or spec.path,
            readonly=spec.readonly,
        )

    def get(self, connection_id: str) -> Adapter:
        with self._lock:
            adapter = self._live.get(connection_id)
        if adapter is None:
            raise DbConnectionNotFound(
                "that connection is no longer open — connect again"
            )
        return adapter

    def close(self, connection_id: str) -> bool:
        with self._lock:
            adapter = self._live.pop(connection_id, None)
        if adapter is None:
            return False
        adapter.close()
        return True

    def close_all(self) -> None:
        with self._lock:
            live = list(self._live.values())
            self._live.clear()
        for adapter in live:
            adapter.close()

    def open_ids(self) -> list[str]:
        with self._lock:
            return list(self._live)


_registry: ConnectionRegistry | None = None


def registry() -> ConnectionRegistry:
    """The app's single registry of live connections."""
    global _registry  # noqa: PLW0603 — one registry per app instance
    if _registry is None:
        _registry = ConnectionRegistry()
    return _registry
