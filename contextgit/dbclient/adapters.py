"""One interface over SQLite, Postgres and SQL Server.

Rules that hold for every engine:

* Drivers are imported **lazily**. A missing one is a readable message
  (`pip install 'contextgit[db]'`), never an ImportError at app start.
* A connection can be **read-only**: writes are refused before they reach the
  server, so browsing a production database cannot mutate it by accident.
* Results are **capped**, and we say when they were.
"""

from __future__ import annotations

import re
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

from contextgit.core.errors import DbError
from contextgit.core.models import (
    DbColumn,
    DbConnectionSpec,
    DbQueryResult,
    DbTable,
)

MAX_ROWS = 500
HARD_ROW_LIMIT = 5000
_WRITE = re.compile(
    r"^\s*(insert|update|delete|drop|alter|create|truncate|grant|revoke|comment|"
    r"merge|replace|vacuum|reindex|attach|detach|pragma\s+\w+\s*=)\b",
    re.IGNORECASE,
)
_ENGINE_HINT = {
    "postgres": "psycopg",
    "sqlserver": "pymssql",
}


def is_write(statement: str) -> bool:
    """True when a statement would change the database (cheap, conservative)."""
    stripped = _strip_comments(statement).strip()
    # A read-only connection must never accept a batch: a harmless first
    # statement can otherwise hide a write after the semicolon.
    if _has_multiple_statements(stripped):
        return True
    stripped = stripped.rstrip(";").strip()
    if stripped.startswith("("):
        stripped = stripped[1:].strip()
    if re.match(r"^\s*(explain\s+)?analyze\b", stripped, re.IGNORECASE):
        return bool(
            re.search(
                r"\b(insert|update|delete|merge|drop|alter|create|truncate)\b",
                stripped,
                re.IGNORECASE,
            )
        )
    if re.match(r"^\s*with\b", stripped, re.IGNORECASE):
        # A CTE can end in a write, or contain one: `WITH gone AS (DELETE ...)`.
        # Conservative here only ever blocks a statement, which is the safe
        # direction for a read-only connection.
        return bool(re.search(r"\b(insert|update|delete|merge)\b", stripped, re.IGNORECASE))
    return bool(_WRITE.match(stripped))


def _strip_comments(statement: str) -> str:
    """Remove SQL comments before applying the conservative statement check."""
    without_block = re.sub(r"/\*.*?\*/", " ", statement, flags=re.DOTALL)
    return re.sub(r"--[^\n]*(?:\n|$)", " ", without_block)


def _has_multiple_statements(statement: str) -> bool:
    """Detect a second non-empty statement without pretending to parse SQL."""
    parts = statement.split(";")
    return any(part.strip() for part in parts[:-1]) and bool(parts[-1].strip())


def _cap(limit: int | None) -> int:
    return max(1, min(limit or MAX_ROWS, HARD_ROW_LIMIT))


def _text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bytes):
        return f"<{len(value)} bytes>"
    return str(value)


class Adapter:
    """What the registry and the routes need from any database."""

    engine: str = ""

    def __init__(self, spec: DbConnectionSpec, password: str | None = None) -> None:
        self.spec = spec
        # FastAPI serves each request on a threadpool thread, so a handle must
        # be safe to use from whichever thread happens to ask next.
        self._lock = threading.Lock()
        self.password = password or ""
        self.server_version: str | None = None

    def connect(self) -> None:
        raise NotImplementedError

    def tables(self) -> list[DbTable]:
        """Tables and views, serialised on this handle's lock."""
        with self._lock:
            return self._tables()

    def query(self, sql: str, limit: int | None = None) -> DbQueryResult:
        """Run one statement, serialised on this handle's lock."""
        with self._lock:
            return self._query(sql, limit)

    def close(self) -> None:
        with self._lock:
            self._close()

    def _tables(self) -> list[DbTable]:
        raise NotImplementedError

    def _query(self, sql: str, limit: int | None = None) -> DbQueryResult:
        raise NotImplementedError

    def _close(self) -> None:
        raise NotImplementedError

    # -- shared helpers ---------------------------------------------------

    def _refuse_writes(self, sql: str) -> None:
        if self.spec.readonly and is_write(sql):
            raise DbError(
                "this connection is read-only, so that statement was not run — "
                "turn off read-only to allow writes"
            )


class SqliteAdapter(Adapter):
    """Local files: always available, no driver to install."""

    engine = "sqlite"

    def __init__(self, spec: DbConnectionSpec, password: str | None = None) -> None:
        super().__init__(spec, password)
        self._conn: sqlite3.Connection | None = None

    def connect(self) -> None:
        raw = (self.spec.path or "").strip()
        path = Path(raw).expanduser() if raw else None
        if path is None:
            raise DbError("a SQLite connection needs a file path")
        if path.exists() and not path.is_file():
            raise DbError(f"{path} is not a file")
        try:
            if self.spec.readonly:
                uri = f"file:{path.resolve()}?mode=ro"
                self._conn = sqlite3.connect(uri, uri=True, check_same_thread=False)
            else:
                self._conn = sqlite3.connect(str(path), check_same_thread=False)
        except sqlite3.Error as exc:
            raise DbError(f"could not open {path}: {exc}") from exc
        self.server_version = f"SQLite {sqlite3.sqlite_version}"

    def _tables(self) -> list[DbTable]:
        conn = self._require()
        rows = conn.execute(
            "SELECT name, type FROM sqlite_master WHERE type IN ('table','view')"
            " AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
        tables: list[DbTable] = []
        for name, kind in rows:
            escaped_name = str(name).replace('"', '""')
            columns = conn.execute(f'PRAGMA table_info("{escaped_name}")').fetchall()
            tables.append(
                DbTable(
                    name=str(name),
                    kind="view" if kind == "view" else "table",
                    columns=[
                        DbColumn(
                            name=str(column[1]),
                            type=str(column[2]) or None,
                            nullable=not bool(column[3]),
                        )
                        for column in columns
                    ],
                )
            )
        return tables

    def _query(self, sql: str, limit: int | None = None) -> DbQueryResult:
        self._refuse_writes(sql)
        conn = self._require()
        started = time.perf_counter()
        try:
            cursor = conn.execute(sql)
            columns = [item[0] for item in cursor.description or []]
            cap = _cap(limit)
            rows = cursor.fetchmany(cap + 1) if cursor.description else []
        except sqlite3.Error as exc:
            raise DbError(str(exc)) from exc
        return DbQueryResult(
            columns=[str(column) for column in columns],
            rows=[[_text(value) for value in row] for row in rows[:cap]],
            row_count=len(rows),
            truncated=len(rows) > cap,
            elapsed_ms=int((time.perf_counter() - started) * 1000),
            statement=sql.strip(),
        )

    def _close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    def _require(self) -> sqlite3.Connection:
        if self._conn is None:
            raise DbError("the connection is closed")
        return self._conn


class PostgresAdapter(Adapter):
    """Postgres via psycopg 3 (the `db` extra)."""

    engine = "postgres"

    def __init__(self, spec: DbConnectionSpec, password: str | None = None) -> None:
        super().__init__(spec, password)
        self._conn: Any = None

    def connect(self) -> None:
        try:
            import psycopg
        except ImportError as exc:  # pragma: no cover - depends on install
            raise DbError(
                "the Postgres driver is not installed — run "
                '`pip install "contextgit[db]"` and restart the app'
            ) from exc
        if not self.spec.host:
            raise DbError("a Postgres connection needs a host")
        try:
            self._conn = psycopg.connect(
                host=self.spec.host,
                port=self.spec.port or 5432,
                dbname=self.spec.database or "postgres",
                user=self.spec.user or "postgres",
                password=self.password,
                sslmode="require" if self.spec.ssl else "prefer",
                connect_timeout=10,
            )
            self._conn.autocommit = True
        except Exception as exc:
            raise DbError(f"could not reach {self.spec.host}: {exc}") from exc
        self.server_version = self._scalar("SELECT version()")

    def _tables(self) -> list[DbTable]:
        conn = self._require()
        rows = conn.execute(
            "SELECT table_schema, table_name, table_type FROM information_schema.tables"
            " WHERE table_schema NOT IN ('pg_catalog', 'information_schema')"
            " ORDER BY table_schema, table_name"
        ).fetchall()
        tables: list[DbTable] = []
        for schema, name, kind in rows:
            columns = conn.execute(
                "SELECT column_name, data_type, is_nullable FROM information_schema.columns"
                " WHERE table_schema = %s AND table_name = %s ORDER BY ordinal_position",
                (schema, name),
            ).fetchall()
            tables.append(
                DbTable(
                    schema_name=str(schema),
                    name=str(name),
                    kind="view" if "view" in str(kind).lower() else "table",
                    columns=[
                        DbColumn(
                            name=str(column[0]),
                            type=str(column[1]),
                            nullable=str(column[2]).upper() == "YES",
                        )
                        for column in columns
                    ],
                )
            )
        return tables

    def _query(self, sql: str, limit: int | None = None) -> DbQueryResult:
        self._refuse_writes(sql)
        conn = self._require()
        started = time.perf_counter()
        try:
            cursor = conn.execute(sql)
            columns = [item.name for item in cursor.description or []]
            cap = _cap(limit)
            rows = cursor.fetchmany(cap + 1) if cursor.description else []
        except Exception as exc:
            raise DbError(str(exc)) from exc
        return DbQueryResult(
            columns=[str(column) for column in columns],
            rows=[[_text(value) for value in row] for row in rows[:cap]],
            row_count=len(rows),
            truncated=len(rows) > cap,
            elapsed_ms=int((time.perf_counter() - started) * 1000),
            statement=sql.strip(),
        )

    def _close(self) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            finally:
                self._conn = None

    def _require(self) -> Any:
        if self._conn is None:
            raise DbError("the connection is closed")
        return self._conn

    def _scalar(self, sql: str) -> str | None:
        try:
            row = self._require().execute(sql).fetchone()
        except Exception:
            return None
        if not row:
            return None
        text = _text(row[0])
        return text[:120] if text else None


class SqlServerAdapter(Adapter):
    """SQL Server via pymssql (the `db` extra)."""

    engine = "sqlserver"

    def __init__(self, spec: DbConnectionSpec, password: str | None = None) -> None:
        super().__init__(spec, password)
        self._conn: Any = None

    def connect(self) -> None:
        try:
            import pymssql
        except ImportError as exc:  # pragma: no cover - depends on install
            raise DbError(
                "the SQL Server driver is not installed — run "
                '`pip install "contextgit[db]"` and restart the app'
            ) from exc
        if not self.spec.host:
            raise DbError("a SQL Server connection needs a host")
        try:
            self._conn = pymssql.connect(
                server=self.spec.host,
                port=str(self.spec.port or 1433),
                database=self.spec.database or "master",
                user=self.spec.user or "sa",
                password=self.password,
                login_timeout=10,
                as_dict=False,
            )
        except Exception as exc:
            raise DbError(f"could not reach {self.spec.host}: {exc}") from exc
        self.server_version = self._scalar("SELECT @@VERSION")

    def _tables(self) -> list[DbTable]:
        conn = self._require()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES"
            " ORDER BY TABLE_SCHEMA, TABLE_NAME"
        )
        rows = cursor.fetchall()
        tables: list[DbTable] = []
        for schema, name, kind in rows:
            cursor.execute(
                "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS"
                " WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s ORDER BY ORDINAL_POSITION",
                (schema, name),
            )
            columns = cursor.fetchall()
            tables.append(
                DbTable(
                    schema_name=str(schema),
                    name=str(name),
                    kind="view" if "VIEW" in str(kind).upper() else "table",
                    columns=[
                        DbColumn(
                            name=str(column[0]),
                            type=str(column[1]),
                            nullable=str(column[2]).upper() == "YES",
                        )
                        for column in columns
                    ],
                )
            )
        return tables

    def _query(self, sql: str, limit: int | None = None) -> DbQueryResult:
        self._refuse_writes(sql)
        conn = self._require()
        started = time.perf_counter()
        try:
            cursor = conn.cursor()
            cursor.execute(sql)
            cap = _cap(limit)
            rows = cursor.fetchmany(cap + 1) if cursor.description else []
            columns = [item[0] for item in cursor.description or []]
        except Exception as exc:
            raise DbError(str(exc)) from exc
        return DbQueryResult(
            columns=[str(column) for column in columns],
            rows=[[_text(value) for value in row] for row in rows[:cap]],
            row_count=len(rows),
            truncated=len(rows) > cap,
            elapsed_ms=int((time.perf_counter() - started) * 1000),
            statement=sql.strip(),
        )

    def _close(self) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            finally:
                self._conn = None

    def _require(self) -> Any:
        if self._conn is None:
            raise DbError("the connection is closed")
        return self._conn

    def _scalar(self, sql: str) -> str | None:
        try:
            cursor = self._require().cursor()
            cursor.execute(sql)
            row = cursor.fetchone()
        except Exception:
            return None
        if not row:
            return None
        text = _text(row[0])
        return text[:120] if text else None


_ADAPTERS: dict[str, type[Adapter]] = {
    "sqlite": SqliteAdapter,
    "postgres": PostgresAdapter,
    "sqlserver": SqlServerAdapter,
}


def build_adapter(spec: DbConnectionSpec, password: str | None = None) -> Adapter:
    """The adapter for an engine, or a clear error for an unknown one."""
    factory = _ADAPTERS.get(spec.engine)
    if factory is None:
        raise DbError(f"unsupported engine: {spec.engine}")
    return factory(spec, password)


def driver_hint(engine: str) -> str | None:
    """The package a missing driver would come from, for the UI's message."""
    package = _ENGINE_HINT.get(engine)
    if package is None:
        return None
    return f"pip install 'contextgit[db]'  # provides {package}"
