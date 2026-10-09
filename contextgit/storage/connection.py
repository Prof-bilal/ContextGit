"""Serialized SQLite transactions shared by domain stores."""

import sqlite3
import threading
from collections.abc import Iterator
from typing import Any, Literal


class _Result:
    """One statement's outcome, captured while the connection lock is held.

    Rows are materialized (and `rowcount`/`lastrowid` snapshotted) at execute
    time, so no cursor is ever stepped after another thread has run its own
    statement on the shared connection — that interleaving surfaced as
    `sqlite3.InterfaceError: bad parameter or other API misuse`.
    """

    __slots__ = ("_rows", "rowcount", "lastrowid")

    def __init__(self, cursor: sqlite3.Cursor) -> None:
        rows: list[Any] = []
        try:
            if cursor.description is not None:  # SELECT: hold the rows, not the cursor
                rows = list(cursor.fetchall())
            self.rowcount = cursor.rowcount
            self.lastrowid = cursor.lastrowid
        finally:
            cursor.close()
        self._rows = rows

    def fetchone(self) -> Any:
        return self._rows[0] if self._rows else None

    def fetchall(self) -> list[Any]:
        return list(self._rows)

    def __iter__(self) -> Iterator[Any]:
        return iter(self._rows)

    def __len__(self) -> int:
        return len(self._rows)


class _GuardedConnection:
    """One SQLite connection, serialized across threads.

    FastAPI runs the sync routes on a thread pool, so several threads reach this
    connection at once — the workspace fires `/repo`,
    `/branches/{name}/budget`, `/sessions` and `/staging` together. Every
    statement runs under one re-entrant lock, `with conn:` holds it for the whole
    transaction, and rows are materialized before it drops. Two callers can no
    longer interleave statements or commit each other's work (bugs.md B4,
    codebase-audit A3).
    """

    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn
        self._lock = threading.RLock()
        self._depth = 0

    def execute(self, sql: str, parameters: Any = ()) -> _Result:
        with self._lock:
            return _Result(self._conn.execute(sql, parameters))

    def executemany(self, sql: str, parameters: Any) -> _Result:
        with self._lock:
            return _Result(self._conn.executemany(sql, parameters))

    def executescript(self, sql: str) -> None:
        # sqlite3.executescript implicitly commits before executing a script.
        # Keep migration DDL and schema-version receipts in the same transaction.
        with self._lock:
            statement = ""
            for character in sql:
                statement += character
                if character == ";" and sqlite3.complete_statement(statement):
                    self._conn.execute(statement).close()
                    statement = ""
            if statement.strip():
                self._conn.execute(statement).close()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    @property
    def row_factory(self) -> Any:
        return self._conn.row_factory

    @row_factory.setter
    def row_factory(self, value: Any) -> None:
        self._conn.row_factory = value

    def __enter__(self) -> "_GuardedConnection":
        self._lock.acquire()
        try:
            if self._depth == 0:
                self._conn.execute("BEGIN")
            else:
                self._conn.execute(f"SAVEPOINT nested_{self._depth}")
            self._depth += 1
        except BaseException:
            self._lock.release()
            raise
        return self

    def __exit__(self, exc_type: Any, exc_value: Any, traceback: Any) -> Literal[False]:
        try:
            self._depth -= 1
            if self._depth == 0:
                if exc_type is None:
                    try:
                        self._conn.commit()
                    except BaseException:
                        self._conn.rollback()
                        raise
                else:
                    self._conn.rollback()
            else:
                if exc_type is not None:
                    self._conn.execute(f"ROLLBACK TO nested_{self._depth}")
                self._conn.execute(f"RELEASE nested_{self._depth}")
            return False
        finally:
            self._lock.release()

