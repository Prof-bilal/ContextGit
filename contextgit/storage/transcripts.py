"""Binding and ingestion receipts, sharing the repository transaction lock."""

import sqlite3
from typing import TYPE_CHECKING

from contextgit.core.models import Message
from contextgit.integration.transcript import CaptureUnavailable, NativeMessage

if TYPE_CHECKING:
    from contextgit.storage.connection import _GuardedConnection


class TranscriptStorage:
    def __init__(self, connection: "_GuardedConnection") -> None:
        self.connection = connection

    def binding(self, session_id: str) -> dict[str, str] | None:
        row = self.connection.execute(
            "SELECT harness, native_id, directory FROM harness_bindings WHERE session_id = ?",
            (session_id,),
        ).fetchone()
        return dict(row) if row else None

    def bind(self, session_id: str, native_id: str, directory: str) -> None:
        with self.connection:
            existing = self.binding(session_id)
            if existing and existing != {
                "harness": "opencode",
                "native_id": native_id,
                "directory": directory,
            }:
                raise CaptureUnavailable(
                    "binding_conflict",
                    "This session is already bound to a different conversation. "
                    "Create a new session.",
                )
            try:
                self.connection.execute(
                    "INSERT OR IGNORE INTO harness_bindings VALUES (?, 'opencode', ?, ?)",
                    (session_id, native_id, directory),
                )
                if self.binding(session_id) is None:
                    raise CaptureUnavailable(
                        "binding_conflict",
                        "This OpenCode conversation is already linked "
                        "to another ContextGit session.",
                    )
            except sqlite3.IntegrityError as error:
                raise CaptureUnavailable(
                    "binding_conflict", "The conversation could not be linked to this session."
                ) from error

    def pending(self, session_id: str, messages: list[NativeMessage]) -> list[Message]:
        for item in messages:
            self.connection.execute(
                "INSERT OR IGNORE INTO captured_messages(session_id, source_id, message_json) "
                "VALUES (?, ?, ?)",
                (session_id, item.source_id, item.message.model_dump_json()),
            )
        return [
            Message.model_validate_json(row[0])
            for row in self.connection.execute(
                "SELECT message_json FROM captured_messages "
                "WHERE session_id = ? AND commit_id IS NULL "
                "ORDER BY julianday(json_extract(message_json, '$.created_at')), source_id",
                (session_id,),
            )
        ]

    def committed(self, session_id: str, commit_id: str, messages: list[Message]) -> None:
        for message in messages:
            self.connection.execute(
                "UPDATE captured_messages SET commit_id = ? "
                "WHERE session_id = ? AND commit_id IS NULL "
                "AND message_json = ?",
                (commit_id, session_id, message.model_dump_json()),
            )
