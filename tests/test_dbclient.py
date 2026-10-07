"""The DB tab: adapters, saved connections, the registry, and the routes."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from contextgit.api.app import create_app
from contextgit.core.errors import DbConnectionNotFound, DbError
from contextgit.core.models import DbConnectionSpec
from contextgit.core.repo import Repo
from contextgit.dbclient import is_write
from contextgit.dbclient.adapters import SqliteAdapter, build_adapter
from contextgit.dbclient.store import ConnectionRegistry, ConnectionStore
from contextgit.llm.fake import FakeProvider


def seed_sqlite(path: Path) -> Path:
    conn = sqlite3.connect(str(path))
    conn.execute("CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL)")
    conn.executemany("INSERT INTO people (name) VALUES (?)", [("Ada",), ("Grace",), ("Alan",)])
    conn.commit()
    conn.close()
    return path


def sqlite_spec(path: Path, *, readonly: bool = True, name: str = "local") -> DbConnectionSpec:
    return DbConnectionSpec(name=name, engine="sqlite", path=str(path), readonly=readonly)


# ------------------------------------------------------------------ guard --


def test_write_detection_is_conservative_but_correct() -> None:
    for statement in (
        "SELECT 1",
        "select * from people",
        "WITH x AS (SELECT 1) SELECT * FROM x",
        "-- a comment\nSELECT 1",
        "PRAGMA table_info(people)",
    ):
        assert not is_write(statement), statement

    for statement in (
        "INSERT INTO people (name) VALUES ('x')",
        "update people set name = 'x'",
        "DELETE FROM people",
        "DROP TABLE people",
        "CREATE TABLE t (a int)",
        "TRUNCATE people",
        "WITH gone AS (DELETE FROM people RETURNING id) SELECT * FROM gone",
    ):
        assert is_write(statement), statement


# --------------------------------------------------------------- adapters --


def test_sqlite_adapter_round_trip_and_cap(tmp_path: Path) -> None:
    database = seed_sqlite(tmp_path / "app.db")
    adapter = SqliteAdapter(sqlite_spec(database, readonly=False))
    adapter.connect()
    try:
        assert adapter.server_version is not None and "SQLite" in adapter.server_version

        result = adapter.query("SELECT name FROM people ORDER BY id")
        assert result.columns == ["name"]
        assert result.row_count == 3
        assert result.truncated is False
        assert result.rows[0] == ["Ada"]

        capped = adapter.query("SELECT name FROM people ORDER BY id", limit=2)
        assert capped.rows == [["Ada"], ["Grace"]]
        assert capped.truncated is True
        assert capped.row_count == 3

        schema = adapter.tables()
        assert [table.name for table in schema] == ["people"]
        assert [column.name for column in schema[0].columns] == ["id", "name"]
        assert schema[0].columns[1].nullable is False
    finally:
        adapter.close()
    with pytest.raises(DbError):
        adapter.query("SELECT 1")


def test_a_read_only_connection_refuses_to_change_anything(tmp_path: Path) -> None:
    database = seed_sqlite(tmp_path / "app.db")
    adapter = SqliteAdapter(sqlite_spec(database, readonly=True))
    adapter.connect()
    try:
        assert adapter.query("SELECT COUNT(*) AS n FROM people").rows == [["3"]]
        with pytest.raises(DbError, match="read-only"):
            adapter.query("DELETE FROM people")
        # And the data is untouched.
        assert adapter.query("SELECT COUNT(*) AS n FROM people").rows == [["3"]]
    finally:
        adapter.close()


def test_sqlite_needs_a_file_and_reports_a_broken_statement(tmp_path: Path) -> None:
    adapter = SqliteAdapter(DbConnectionSpec(name="x", engine="sqlite", path=None))
    with pytest.raises(DbError, match="file path"):
        adapter.connect()

    database = seed_sqlite(tmp_path / "app.db")
    good = SqliteAdapter(sqlite_spec(database, readonly=False))
    good.connect()
    try:
        with pytest.raises(DbError):
            good.query("SELECT * FROM nope")
    finally:
        good.close()


@pytest.mark.parametrize("engine", ["postgres", "sqlserver"])
def test_network_engines_explain_a_missing_driver(engine: str) -> None:
    """Without the extra installed, the message must say what to install."""
    module = "psycopg" if engine == "postgres" else "pymssql"
    try:
        __import__(module)
    except ImportError:
        pass
    else:
        pytest.skip(f"{module} is installed here; nothing to assert")

    spec = DbConnectionSpec(name="prod", engine=engine, host="db.example.test")  # type: ignore[arg-type]
    adapter = build_adapter(spec)
    with pytest.raises(DbError, match=r"contextgit\[db\]"):
        adapter.connect()


def test_an_unknown_engine_is_rejected() -> None:
    spec = DbConnectionSpec(name="x", engine="postgres")
    spec.engine = "oracle"  # type: ignore[assignment]
    with pytest.raises(DbError, match="unsupported engine"):
        build_adapter(spec)


# ------------------------------------------------------- store and registry --


def test_connections_are_files_without_secrets(tmp_path: Path) -> None:
    store = ConnectionStore(tmp_path)
    spec = DbConnectionSpec(
        name="Prod", engine="postgres", host="db.example.test", database="app", user="reader"
    )
    store.save(spec)

    assert store.list() == ["Prod"]
    written = (tmp_path / "db" / "Prod.json").read_text()
    assert "password" not in written.lower()
    assert store.get("Prod").host == "db.example.test"

    assert store.delete("Prod") is True
    assert store.list() == []
    with pytest.raises(DbError):
        store.get("../escape")
    with pytest.raises(DbError):
        store.get("Prod")


def test_registry_opens_tracks_and_closes(tmp_path: Path) -> None:
    database = seed_sqlite(tmp_path / "app.db")
    registry = ConnectionRegistry()
    info = registry.open(sqlite_spec(database), password=None)
    try:
        assert info.id in registry.open_ids()
        assert info.engine == "sqlite"
        assert registry.get(info.id).query("SELECT 1 AS one").rows == [["1"]]
    finally:
        assert registry.close(info.id) is True
    assert registry.open_ids() == []
    with pytest.raises(DbConnectionNotFound):
        registry.get(info.id)


def test_registry_close_all_clears_everything(tmp_path: Path) -> None:
    database = seed_sqlite(tmp_path / "app.db")
    registry = ConnectionRegistry()
    registry.open(sqlite_spec(database, name="a"))
    registry.open(sqlite_spec(database, name="b"))
    assert len(registry.open_ids()) == 2
    registry.close_all()
    assert registry.open_ids() == []


# ------------------------------------------------------------------ routes --


def test_db_routes_browse_and_query(tmp_path: Path) -> None:
    database = seed_sqlite(tmp_path / "app.db")
    repo = Repo.init(tmp_path / "repo")
    client = TestClient(create_app(repo=repo, provider=FakeProvider()))

    drivers = client.get("/api/v1/db/drivers")
    assert drivers.status_code == 200
    assert drivers.json()["sqlite"] is True

    spec = sqlite_spec(database, readonly=False, name="Local")
    saved = client.put("/api/v1/db/connections/Local", json=spec.model_dump(mode="json"))
    assert saved.status_code == 200
    assert client.get("/api/v1/db/connections").json() == ["Local"]

    opened = client.post(
        "/api/v1/db/open", json={"spec": spec.model_dump(mode="json"), "password": None}
    )
    assert opened.status_code == 200
    connection_id = opened.json()["id"]
    assert opened.json()["server_version"].startswith("SQLite")

    schema = client.get("/api/v1/db/schema", params={"connection_id": connection_id})
    assert schema.status_code == 200
    assert [table["name"] for table in schema.json()] == ["people"]

    queried = client.post(
        "/api/v1/db/query",
        json={"connection_id": connection_id, "sql": "SELECT name FROM people ORDER BY id"},
    )
    assert queried.status_code == 200
    assert queried.json()["rows"][0] == ["Ada"]

    closed = client.request("DELETE", f"/api/v1/db/open/{connection_id}")
    assert closed.status_code == 200 and closed.json() is True

    assert client.delete("/api/v1/db/connections/Local").status_code == 204
    assert client.get("/api/v1/db/connections").json() == []


def test_querying_a_closed_connection_is_a_clear_404(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    client = TestClient(create_app(repo=repo, provider=FakeProvider()))
    response = client.post(
        "/api/v1/db/query", json={"connection_id": "nope", "sql": "SELECT 1"}
    )
    assert response.status_code == 404
    assert "no longer open" in response.json()["error"]
