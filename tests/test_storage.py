"""Storage layer tests: schema, CRUD round-trips, migrations."""

from datetime import UTC, datetime
from pathlib import Path
from typing import cast

import pytest

from contextgit.core.errors import BranchNotFound, CommitNotFound
from contextgit.core.models import Branch, Commit, CommitKind, Message, Tag
from contextgit.storage.sqlite import SqliteStorage


@pytest.fixture
def storage(tmp_path: Path):
    s = SqliteStorage(tmp_path / "t.db")
    yield s
    s.close()


def make_commit(i: int = 0, parents: list[str] | None = None, kind: str = "normal") -> Commit:
    return Commit(
        id=f"{i:064x}",
        parent_ids=parents or [],
        messages=[
            Message(role="user", content=f"m{i}", created_at=datetime(2026, 1, 1, tzinfo=UTC))
        ],
        kind=cast("CommitKind", kind),
        model="test-model",
        summary=f"summary {i}",
        token_count=10,
        author="tester",
    )


class TestSchema:
    def test_tables_exist(self, storage: SqliteStorage) -> None:
        tables = {
            row[0]
            for row in storage._conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        assert {
            "commits",
            "messages",
            "branches",
            "tags",
            "repo_state",
            "schema_version",
            "sessions",
            "staging",
            "teams",
            "tasks",
            "task_deps",
            "team_messages",
            "team_events",
            "usage_events",
        } <= tables

    def test_migration_recorded_once(self, storage: SqliteStorage) -> None:
        versions = [r[0] for r in storage._conn.execute("SELECT version FROM schema_version")]
        assert versions == [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]

    def test_reopen_does_not_reapply(self, tmp_path: Path) -> None:
        db = tmp_path / "again.db"
        SqliteStorage(db).close()
        s2 = SqliteStorage(db)
        versions = [r[0] for r in s2._conn.execute("SELECT version FROM schema_version")]
        s2.close()
        assert versions == [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]


class TestCommits:
    def test_round_trip(self, storage: SqliteStorage) -> None:
        c = make_commit(1, parents=["0" * 64])
        storage.insert_commit(c)
        got = storage.get_commit(c.id)
        assert got.id == c.id
        assert got.parent_ids == c.parent_ids
        assert got.model == "test-model"
        assert got.messages[0].content == "m1"
        assert got.summary == "summary 1"

    def test_missing_commit_raises(self, storage: SqliteStorage) -> None:
        with pytest.raises(CommitNotFound):
            storage.get_commit("f" * 64)

    def test_multiple_messages_ordered(self, storage: SqliteStorage) -> None:
        c = make_commit(2)
        c = c.model_copy(
            update={
                "messages": [
                    Message(role="user", content="first"),
                    Message(role="assistant", content="second"),
                    Message(role="user", content="third"),
                ]
            }
        )
        storage.insert_commit(c)
        got = storage.get_commit(c.id)
        assert [m.content for m in got.messages] == ["first", "second", "third"]
        assert [m.role for m in got.messages] == ["user", "assistant", "user"]


class TestBranchesTags:
    def test_branch_round_trip(self, storage: SqliteStorage) -> None:
        root_id = f"{0:064x}"
        next_id = f"{1:064x}"
        storage.insert_commit(make_commit(0, kind="root"))
        storage.insert_commit(make_commit(1, parents=[root_id]))
        storage.insert_branch(Branch(name="main", head_commit_id=root_id))
        assert storage.get_branch("main").head_commit_id == root_id
        storage.update_branch_head("main", next_id)
        assert storage.get_branch("main").head_commit_id == next_id

    def test_branch_missing(self, storage: SqliteStorage) -> None:
        with pytest.raises(BranchNotFound):
            storage.get_branch("nope")
        with pytest.raises(BranchNotFound):
            storage.update_branch_head("nope", "0" * 64)
        with pytest.raises(BranchNotFound):
            storage.delete_branch("nope")

    def test_tag_round_trip(self, storage: SqliteStorage) -> None:
        storage.insert_commit(make_commit(0))
        storage.insert_tag(Tag(name="v1", commit_id="0" * 64, label="known-good"))
        t = storage.get_tag("v1")
        assert t.label == "known-good"
        assert [x.name for x in storage.list_tags()] == ["v1"]

    def test_head_state(self, storage: SqliteStorage) -> None:
        storage.set_current_branch("main")
        assert storage.get_current_branch() == "main"
        storage.set_current_branch("dev")
        assert storage.get_current_branch() == "dev"
