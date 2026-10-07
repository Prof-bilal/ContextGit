"""Collections of saved requests, stored as JSON files inside the repo.

Files (not database rows) so a collection is a git-versionable artefact next to
the conversation history: `<repo>/api/<name>.json`.
"""

from __future__ import annotations

import re
from pathlib import Path

from contextgit.core.errors import CollectionNotFound, HttpRequestError
from contextgit.core.models import HttpCollection

_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$")


class CollectionStore:
    """Read/write the repo's `api/` directory."""

    def __init__(self, root: Path | str) -> None:
        self._dir = Path(root) / "api"

    def _path(self, name: str) -> Path:
        if not _NAME.match(name or ""):
            raise HttpRequestError(
                "invalid collection name (letters, digits, . _ - and spaces only)"
            )
        return self._dir / f"{name}.json"

    def list(self) -> list[str]:
        if not self._dir.exists():
            return []
        return sorted(path.stem for path in self._dir.glob("*.json"))

    def get(self, name: str) -> HttpCollection:
        path = self._path(name)
        if not path.exists():
            raise CollectionNotFound(name)
        return HttpCollection.model_validate_json(path.read_text("utf-8"))

    def save(self, collection: HttpCollection) -> HttpCollection:
        self._dir.mkdir(parents=True, exist_ok=True)
        self._path(collection.name).write_text(
            collection.model_dump_json(indent=2) + "\n", "utf-8"
        )
        return collection

    def delete(self, name: str) -> bool:
        path = self._path(name)
        if not path.exists():
            return False
        path.unlink()
        return True
