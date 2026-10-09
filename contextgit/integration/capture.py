"""Structured conversation capture independent of terminal rendering and checkpoints."""

import hashlib
import json
from pathlib import Path
from typing import TYPE_CHECKING

from contextgit.core.models import Message
from contextgit.integration.transcript import (
    CaptureUnavailable,
    opencode_candidates,
    opencode_messages,
)

if TYPE_CHECKING:
    from contextgit.core.repo import Repo
    from contextgit.storage.sqlite import SqliteStorage


class TranscriptService:
    def __init__(self, repo: "Repo", storage: "SqliteStorage", root: Path) -> None:
        self.repo = repo
        self.storage = storage
        self.root = root

    def directory(self, session_id: str) -> str:
        session = self.repo.get_session(session_id)
        if session.agent != "opencode":
            raise CaptureUnavailable(
                "unsupported", "Structured capture is not implemented for this harness yet."
            )
        directory = session.worktree_path or session.project_path
        if not directory:
            raise CaptureUnavailable(
                "unbound", "Choose a project before capturing this conversation."
            )
        return str(Path(directory).resolve())

    def binding(self, session_id: str) -> dict[str, str] | None:
        directory = self.directory(session_id)
        existing = self.storage.transcripts.binding(session_id)
        if existing:
            if existing["directory"] != directory:
                raise CaptureUnavailable(
                    "wrong_project",
                    "The session project no longer matches its saved conversation binding.",
                )
            return existing
        key = hashlib.sha256(session_id.encode()).hexdigest()
        receipt = self.root / "captures" / "opencode" / f"{key}.json"
        if receipt.is_file():
            try:
                value = json.loads(receipt.read_text())
                if (
                    value["session_id"] != session_id
                    or str(Path(value["directory"]).resolve()) != directory
                ):
                    raise CaptureUnavailable(
                        "wrong_project", "The OpenCode launch binding does not match this session."
                    )
                self.bind(session_id, value["native_id"], require_complete=False)
            except (OSError, json.JSONDecodeError, KeyError, TypeError) as error:
                raise CaptureUnavailable(
                    "unbound",
                    "The OpenCode launch binding is unreadable. "
                    "Restart or select its native conversation.",
                ) from error
        return self.storage.transcripts.binding(session_id)

    def bind(self, session_id: str, native_id: str, *, require_complete: bool = True) -> None:
        directory = self.directory(session_id)
        try:
            opencode_messages(native_id, directory)
        except CaptureUnavailable as error:
            if require_complete or error.status not in {"incomplete", "interrupted"}:
                raise
        self.storage.transcripts.bind(session_id, native_id, directory)

    def choices(self, session_id: str) -> list[dict[str, str]]:
        return opencode_candidates(self.directory(session_id))

    def capture(self, session_id: str) -> list[Message]:
        binding = self.binding(session_id)
        if not binding:
            raise CaptureUnavailable(
                "unbound",
                "This terminal has no saved OpenCode conversation ID. "
                "Select its conversation below, or restart to enable capture.",
            )
        native = opencode_messages(binding["native_id"], binding["directory"])
        with self.storage.transaction():
            pending = self.storage.transcripts.pending(session_id, native)
            staged = self.repo.staged(session_id)
            keys = {(item.role, item.content, item.created_at) for item in staged}
            additions = [
                item for item in pending if (item.role, item.content, item.created_at) not in keys
            ]
            return self.repo.stage(session_id, additions) if additions else staged
