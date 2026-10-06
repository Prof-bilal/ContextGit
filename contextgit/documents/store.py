"""Where generated documents live: `<repo>/.contextgit/documents/<id>.<ext>`.

A rendered file is cached so it can be re-downloaded; the user's own copy is
written wherever the native Save dialog points. Each document also gets a small
`<id>.json` sidecar with its pretty filename and title.
"""

import json
import re
from datetime import UTC, datetime
from pathlib import Path

from contextgit.core.models import utcnow
from contextgit.documents.models import DOCUMENT_EXTENSIONS, DocumentFormat, DocumentInfo

_SLUG = re.compile(r"[^a-z0-9]+")
_META_KEYS = ("id", "filename", "format", "title", "size", "created_at")


def documents_dir(repo_root: Path) -> Path:
    directory = repo_root / ".contextgit" / "documents"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def slug(text: str, limit: int = 60) -> str:
    """A filesystem-safe slug for a document title."""
    cleaned = _SLUG.sub("-", text.lower()).strip("-")
    return cleaned[:limit].strip("-") or "document"


def filename_for(title: str, document_id: str, fmt: DocumentFormat) -> str:
    return f"{slug(title)}-{document_id}.{DOCUMENT_EXTENSIONS[fmt]}"


def save(
    repo_root: Path,
    document_id: str,
    fmt: DocumentFormat,
    filename: str,
    title: str,
    data: bytes,
) -> Path:
    """Write the rendered bytes + a metadata sidecar; return the file path."""
    directory = documents_dir(repo_root)
    path = directory / f"{document_id}.{DOCUMENT_EXTENSIONS[fmt]}"
    path.write_bytes(data)
    meta = {
        "id": document_id,
        "filename": filename,
        "format": fmt,
        "title": title,
        "size": len(data),
        "created_at": utcnow().isoformat(),
    }
    (directory / f"{document_id}.json").write_text(json.dumps(meta), "utf-8")
    return path


def list_documents(repo_root: Path) -> list[DocumentInfo]:
    """Every generated document, newest first (for the Docs library)."""
    documents: list[DocumentInfo] = []
    for meta_path in documents_dir(repo_root).glob("*.json"):
        try:
            parsed = json.loads(meta_path.read_text("utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(parsed, dict):
            continue
        fmt = parsed.get("format")
        if fmt not in DOCUMENT_EXTENSIONS:
            continue
        documents.append(
            DocumentInfo(
                id=str(parsed.get("id") or meta_path.stem),
                filename=str(parsed.get("filename") or meta_path.stem),
                format=fmt,
                size=int(parsed.get("size") or 0),
                title=str(parsed.get("title") or ""),
                created_at=_parse_time(parsed.get("created_at"), meta_path),
            )
        )
    documents.sort(key=lambda document: document.created_at, reverse=True)
    return documents


def _parse_time(value: object, meta_path: Path) -> datetime:
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            pass
    return datetime.fromtimestamp(meta_path.stat().st_mtime, tz=UTC)


def path_for(repo_root: Path, document_id: str, fmt: DocumentFormat) -> Path | None:
    path = documents_dir(repo_root) / f"{document_id}.{DOCUMENT_EXTENSIONS[fmt]}"
    return path if path.exists() else None


def metadata_for(repo_root: Path, document_id: str) -> dict[str, str] | None:
    meta = documents_dir(repo_root) / f"{document_id}.json"
    if not meta.exists():
        return None
    try:
        parsed = json.loads(meta.read_text("utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(parsed, dict):
        return None
    return {key: str(parsed[key]) for key in _META_KEYS if key in parsed}
