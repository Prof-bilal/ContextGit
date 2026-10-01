"""SQLite-backed storage. The only code that talks SQL.

Schema changes require a numbered migration in storage/migrations/ applied
in filename order; the applied set is recorded in schema_version (one row
per applied migration number).
"""

import json
import sqlite3
from importlib import resources
from pathlib import Path
from typing import cast

from contextgit.core.errors import BranchNotFound, CommitNotFound
from contextgit.core.models import Branch, Commit, CommitKind, Message, Role, Tag

_MIGRATIONS_DIR = "migrations"


class SqliteStorage:
    """Owns the SQLite file and all persistence for one repository."""

    def __init__(self, db_path: Path | str) -> None:
        self._db_path = Path(db_path)
        self._conn: sqlite3.Connection
        self._connect()
        self._migrate()

    # ---------- connection / schema ----------

    def _connect(self) -> None:
        self._conn = sqlite3.connect(self._db_path)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")

    def close(self) -> None:
        self._conn.close()

    def _applied_versions(self) -> set[int]:
        cur = self._conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
        )
        if cur.fetchone() is None:
            return set()
        return {int(row[0]) for row in self._conn.execute("SELECT version FROM schema_version")}

    def _migration_files(self) -> list[tuple[int, str]]:
        files: list[tuple[int, str]] = []
        root = resources.files("contextgit.storage") / _MIGRATIONS_DIR
        for entry in root.iterdir():
            name = entry.name
            if name.endswith(".sql") and name[:4].isdigit():
                files.append((int(name[:4]), name))
        return sorted(files)

    def _migrate(self) -> None:
        applied = self._applied_versions()
        migrations = resources.files("contextgit.storage") / _MIGRATIONS_DIR
        for version, name in self._migration_files():
            if version in applied:
                continue
            sql = (migrations / name).read_text("utf-8")
            with self._conn:
                self._conn.executescript(sql)
                self._conn.execute("INSERT INTO schema_version (version) VALUES (?)", (version,))

    # ---------- commits ----------

    def insert_commit(self, commit: Commit) -> None:
        with self._conn:
            self._conn.execute(
                "INSERT INTO commits"
                " (id, parent_ids, kind, model, summary, token_count, author, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    commit.id,
                    json.dumps(commit.parent_ids),
                    commit.kind,
                    commit.model,
                    commit.summary,
                    commit.token_count,
                    commit.author,
                    commit.created_at.isoformat(),
                ),
            )
            for seq, msg in enumerate(commit.messages):
                self._conn.execute(
                    "INSERT INTO messages"
                    " (commit_id, seq, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
                    (commit.id, seq, msg.role, msg.content, msg.created_at.isoformat()),
                )

    def get_commit(self, commit_id: str) -> Commit:
        row = self._conn.execute("SELECT * FROM commits WHERE id = ?", (commit_id,)).fetchone()
        if row is None:
            raise CommitNotFound(f"commit {commit_id[:12]} not found")
        messages = [
            Message(role=cast("Role", r["role"]), content=r["content"], created_at=r["created_at"])
            for r in self._conn.execute(
                "SELECT role, content, created_at FROM messages WHERE commit_id = ? ORDER BY seq",
                (commit_id,),
            )
        ]
        return Commit(
            id=row["id"],
            parent_ids=json.loads(row["parent_ids"]),
            messages=messages,
            kind=cast("CommitKind", row["kind"]),
            model=row["model"],
            summary=row["summary"],
            token_count=row["token_count"],
            author=row["author"],
            created_at=row["created_at"],
        )

    def has_commit(self, commit_id: str) -> bool:
        row = self._conn.execute("SELECT 1 FROM commits WHERE id = ?", (commit_id,)).fetchone()
        return row is not None

    def all_commit_ids(self) -> list[str]:
        return [row[0] for row in self._conn.execute("SELECT id FROM commits")]

    # ---------- branches / HEAD ----------

    def insert_branch(self, branch: Branch) -> None:
        with self._conn:
            self._conn.execute(
                "INSERT INTO branches (name, head_commit_id) VALUES (?, ?)",
                (branch.name, branch.head_commit_id),
            )

    def get_branch(self, name: str) -> Branch:
        sql = "SELECT name, head_commit_id FROM branches WHERE name = ?"
        row = self._conn.execute(sql, (name,)).fetchone()
        if row is None:
            raise BranchNotFound(f"branch '{name}' not found")
        return Branch(name=row["name"], head_commit_id=row["head_commit_id"])

    def list_branches(self) -> list[Branch]:
        rows = self._conn.execute(
            "SELECT name, head_commit_id FROM branches ORDER BY name"
        ).fetchall()
        return [Branch(name=r["name"], head_commit_id=r["head_commit_id"]) for r in rows]

    def update_branch_head(self, name: str, head_commit_id: str) -> None:
        with self._conn:
            cur = self._conn.execute(
                "UPDATE branches SET head_commit_id = ? WHERE name = ?", (head_commit_id, name)
            )
            if cur.rowcount == 0:
                raise BranchNotFound(f"branch '{name}' not found")

    def delete_branch(self, name: str) -> None:
        with self._conn:
            cur = self._conn.execute("DELETE FROM branches WHERE name = ?", (name,))
            if cur.rowcount == 0:
                raise BranchNotFound(f"branch '{name}' not found")

    # ---------- tags ----------

    def insert_tag(self, tag: Tag) -> None:
        with self._conn:
            self._conn.execute(
                "INSERT INTO tags (name, commit_id, label) VALUES (?, ?, ?)",
                (tag.name, tag.commit_id, tag.label),
            )

    def get_tag(self, name: str) -> Tag:
        sql = "SELECT name, commit_id, label FROM tags WHERE name = ?"
        row = self._conn.execute(sql, (name,)).fetchone()
        if row is None:
            raise CommitNotFound(f"tag '{name}' not found")
        return Tag(name=row["name"], commit_id=row["commit_id"], label=row["label"])

    def list_tags(self) -> list[Tag]:
        sql = "SELECT name, commit_id, label FROM tags ORDER BY name"
        rows = self._conn.execute(sql).fetchall()
        return [Tag(name=r["name"], commit_id=r["commit_id"], label=r["label"]) for r in rows]

    # ---------- repo state (HEAD) ----------

    def get_current_branch(self) -> str:
        row = self._conn.execute("SELECT current_branch FROM repo_state WHERE id = 1").fetchone()
        if row is None:
            raise RuntimeError("repo_state is empty; repository not initialized")
        return str(row["current_branch"])

    def set_current_branch(self, name: str) -> None:
        with self._conn:
            self._conn.execute(
                "INSERT INTO repo_state (id, current_branch) VALUES (1, ?)"
                " ON CONFLICT(id) DO UPDATE SET current_branch = excluded.current_branch",
                (name,),
            )
