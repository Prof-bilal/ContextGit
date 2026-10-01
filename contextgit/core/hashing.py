"""Content-addressed commit hashing.

The canonical form is fixed forever: changing it would change every commit
id. It is byte-compatible with the landing page demo (lib/landing.ts), which
is the user-visible spec:

- JSON object with keys in this exact order: messages, metadata, parent_ids
- messages: [{content: <str>, role: "user"}] — content escaped exactly like
  JavaScript JSON.stringify (non-ASCII kept literal, minimal escaping)
- metadata: {kind, model}
- parent_ids: list of parent commit ids
- Encoded UTF-8, hashed with SHA-256, lowercase hex digest

The generic helpers (sort_keys, no whitespace) match the data model doc.
"""

import hashlib
import json
from decimal import Decimal
from typing import Any

from contextgit.core.models import Commit

__all__ = ["canonical_json", "commit_id", "content_commit_id"]


def _stringify(obj: Any) -> str:
    """Render scalars the way JavaScript JSON.stringify does.

    Python json emits `true`/`false`/`null` the same way, but differs on
    Decimal; this keeps the door open for exact float control later.
    """
    if isinstance(obj, bool) or obj is None:
        return json.dumps(obj)
    if isinstance(obj, Decimal):
        return str(obj)
    return json.dumps(obj)


def canonical_json(obj: Any) -> str:
    """Serialize to canonical JSON: sorted keys, no whitespace variance.

    Separators are `,`/`:` with no padding; keys sorted; UTF-8 content is
    emitted literally (ensure_ascii=False) to match JSON.stringify.
    """
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def content_commit_id(
    content: str,
    *,
    model: str,
    kind: str = "normal",
    parent_ids: list[str] | None = None,
) -> str:
    """Commit id for a commit carrying a single user message with `content`.

    Mirrors the landing page demo byte for byte (used by tests to lock the
    format against the JS implementation).
    """
    payload = (
        '{"messages":[{"content":' + json.dumps(content, ensure_ascii=False) + ',"role":"user"}],'
        '"metadata":{"kind":' + json.dumps(kind) + ',"model":' + json.dumps(model) + "},"
        '"parent_ids":' + json.dumps(parent_ids or ["a3f9c21"]) + "}"
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def commit_id(
    *,
    parent_ids: list[str],
    messages: list[tuple[str, str]],
    kind: str,
    model: str,
) -> str:
    """Compute a commit id from its content.

    `messages` is a list of (role, content) pairs. The canonical object is
    {messages, metadata: {kind, model}, parent_ids} with keys sorted by
    canonical_json; the digest is lowercase hex.

    Determinism contract (data-model.md): same inputs -> same id, always.
    """
    payload: dict[str, Any] = {
        "messages": [{"content": c, "role": r} for (r, c) in messages],
        "metadata": {"kind": kind, "model": model},
        "parent_ids": list(parent_ids),
    }
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


def id_for_commit(commit: Commit) -> str:
    """Convenience wrapper computing the id for an in-memory Commit."""
    return commit_id(
        parent_ids=commit.parent_ids,
        messages=[(m.role, m.content) for m in commit.messages],
        kind=commit.kind,
        model=commit.model,
    )
