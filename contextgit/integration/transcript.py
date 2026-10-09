"""Read structured native conversations. Never infer identity from a TUI screen."""

import json
import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from contextgit.core.models import Message


class CaptureUnavailable(ValueError):
    def __init__(self, status: str, detail: str) -> None:
        super().__init__(detail)
        self.status = status


@dataclass(frozen=True)
class NativeMessage:
    source_id: str
    message: Message


def opencode_database() -> Path:
    return (
        Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local/share")))
        / "opencode/opencode.db"
    )


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    database = opencode_database()
    if not database.is_file():
        raise CaptureUnavailable("missing", "OpenCode history database is missing on this machine.")
    connection = sqlite3.connect(f"{database.resolve().as_uri()}?mode=ro", uri=True, timeout=2)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("BEGIN")
        yield connection
    finally:
        connection.close()


def opencode_candidates(directory: str) -> list[dict[str, str]]:
    """Explicit recovery choices, scoped to the owning project/worktree."""
    try:
        with _connect() as connection:
            return [
                dict(row)
                for row in connection.execute(
                    "SELECT id, title FROM session WHERE directory = ? "
                    "ORDER BY time_updated DESC, id LIMIT 50",
                    (str(Path(directory).resolve()),),
                )
            ]
    except sqlite3.Error as error:
        raise CaptureUnavailable(
            "unsupported", "OpenCode history schema is unsupported or unreadable."
        ) from error


def opencode_messages(
    native_id: str,
    directory: str,
    until: datetime | None = None,
) -> list[NativeMessage]:
    """Only text parts; exact ID plus project ownership, including completed replies."""
    try:
        with _connect() as connection:
            session = connection.execute(
                "SELECT directory FROM session WHERE id = ?", (native_id,)
            ).fetchone()
            if session is None:
                raise CaptureUnavailable(
                    "missing", "The bound OpenCode conversation no longer exists."
                )
            if Path(session["directory"]).resolve() != Path(directory).resolve():
                raise CaptureUnavailable(
                    "wrong_project", "OpenCode conversation belongs to another project or worktree."
                )
            end = int(until.timestamp() * 1000) if until else 9223372036854775807
            rows = connection.execute(
                "SELECT id, data, time_created FROM message WHERE session_id = ? "
                "AND time_created <= ? ORDER BY time_created, id",
                (native_id, end),
            ).fetchall()
            parts: dict[str, list[str]] = {}
            for row in connection.execute(
                "SELECT part.message_id, part.data FROM part "
                "JOIN message ON message.id = part.message_id "
                "WHERE message.session_id = ? AND message.time_created <= ? "
                "ORDER BY part.time_created, part.id",
                (native_id, end),
            ):
                part = json.loads(row["data"])
                if part.get("type") == "text" and not part.get("synthetic"):
                    parts.setdefault(row["message_id"], []).append(part.get("text", ""))
            result = []
            pending = False
            interrupted = False
            for row in rows:
                data = json.loads(row["data"])
                role = data.get("role")
                if role not in {"user", "assistant"}:
                    continue
                completed = data.get("time", {}).get("completed")
                if role == "assistant" and data.get("error"):
                    interrupted = True
                    pending = True
                    continue  # Aborted/error text is not a completed AI response.
                if role == "assistant" and (not completed or completed > end):
                    if until:
                        continue
                    raise CaptureUnavailable(
                        "incomplete",
                        "OpenCode is still generating a reply. Checkpoint after it completes.",
                    )
                text = "\n".join(parts.get(row["id"], [])).strip()
                if not text:
                    continue
                pending = role == "user" or data.get("finish") in {"tool-calls", "unknown"}
                interrupted = False
                result.append(
                    NativeMessage(
                        row["id"],
                        Message(
                            role=role,
                            content=text,
                            created_at=datetime.fromtimestamp(row["time_created"] / 1000, UTC),
                        ),
                    )
                )
            if not until and (pending or not result):
                raise CaptureUnavailable(
                    "interrupted" if interrupted else "incomplete",
                    "The OpenCode reply was interrupted. Resume it before checkpointing."
                    if interrupted
                    else "No completed OpenCode prompt/reply is available yet.",
                )
            return result
    except (sqlite3.Error, json.JSONDecodeError, TypeError, AttributeError) as error:
        raise CaptureUnavailable(
            "unsupported", "OpenCode history schema is unsupported or unreadable."
        ) from error
