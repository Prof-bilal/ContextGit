"""SQLite-backed storage. The only code that talks SQL.

Schema changes require a numbered migration in storage/migrations/ applied
in filename order; the applied set is recorded in schema_version (one row
per applied migration number).
"""

import json
import sqlite3
import threading
from collections.abc import Iterator
from importlib import resources
from pathlib import Path
from typing import Any, Literal, cast

from contextgit.core.errors import (
    BranchNotFound,
    CommitNotFound,
    MergeQueueEntryNotFound,
    SessionNotFound,
    TaskNotFound,
    TeamNotFound,
)
from contextgit.core.models import (
    AuthStyle,
    Branch,
    Commit,
    CommitKind,
    EnvEntry,
    MergeQueueEntry,
    MergeStatus,
    Message,
    ProviderCapability,
    ProviderKind,
    ProviderRecord,
    Role,
    Session,
    SessionKind,
    SessionStatus,
    Tag,
    Task,
    TaskStatus,
    Team,
    TeamEvent,
    TeamMessage,
    TeamMessageKind,
    UsageEvent,
    UsageSource,
    UsageSurface,
    utcnow,
)

_MIGRATIONS_DIR = "migrations"


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
    connection at once — the Chat screen alone fires `/repo`,
    `/branches/{name}/budget`, `/sessions` and `/staging` together. Every
    statement runs under one re-entrant lock, `with conn:` holds it for the whole
    transaction, and rows are materialized before it drops. Two callers can no
    longer interleave statements or commit each other's work (bugs.md B4,
    codebase-audit A3).
    """

    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn
        self._lock = threading.RLock()

    def execute(self, sql: str, parameters: Any = ()) -> _Result:
        with self._lock:
            return _Result(self._conn.execute(sql, parameters))

    def executemany(self, sql: str, parameters: Any) -> _Result:
        with self._lock:
            return _Result(self._conn.executemany(sql, parameters))

    def executescript(self, sql: str) -> None:
        with self._lock:
            self._conn.executescript(sql)

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
            self._conn.__enter__()
        except BaseException:
            self._lock.release()
            raise
        return self

    def __exit__(self, exc_type: Any, exc_value: Any, traceback: Any) -> bool:
        try:
            return bool(self._conn.__exit__(exc_type, exc_value, traceback))
        finally:
            self._lock.release()


class SqliteStorage:
    """Owns the SQLite file and all persistence for one repository."""

    def __init__(self, db_path: Path | str) -> None:
        self._db_path = Path(db_path)
        self._conn: _GuardedConnection
        self._connect()
        self._migrate()

    # ---------- connection / schema ----------

    def _connect(self) -> None:
        # FastAPI handlers and TestClient can execute requests on a different
        # thread, so the connection is shared and every statement runs under the
        # guard's lock. (SQLite itself does not serialize statements for us.)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        raw = sqlite3.connect(self._db_path, check_same_thread=False)
        raw.row_factory = sqlite3.Row
        self._conn = _GuardedConnection(raw)
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._conn.execute("PRAGMA journal_mode = WAL")
        self._conn.execute("PRAGMA synchronous = NORMAL")
        self._conn.execute("PRAGMA busy_timeout = 5000")
        # Provider credentials live in this database. Enforce private file
        # permissions both for new repositories and existing databases.
        try:
            self._db_path.chmod(0o600)
        except OSError:
            # Read-only filesystems can still be opened and reported normally.
            pass

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

    def append_commit(self, name: str, commit: Commit, expected_head_id: str) -> None:
        """Insert a commit and advance its branch atomically with a CAS."""
        from contextgit.core.errors import StaleMergePreview

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
            updated = self._conn.execute(
                "UPDATE branches SET head_commit_id = ? "
                "WHERE name = ? AND head_commit_id = ?",
                (commit.id, name, expected_head_id),
            )
            if updated.rowcount == 0:
                if self._conn.execute(
                    "SELECT 1 FROM branches WHERE name = ?", (name,)
                ).fetchone() is not None:
                    raise StaleMergePreview(f"branch '{name}' moved while it was being updated")
                raise BranchNotFound(f"branch '{name}' not found")

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

    @staticmethod
    def _row_to_branch(row: sqlite3.Row) -> Branch:
        return Branch(
            name=row["name"],
            head_commit_id=row["head_commit_id"],
            deleted_at=row["deleted_at"],
        )

    def get_branch(self, name: str) -> Branch:
        row = self._conn.execute("SELECT * FROM branches WHERE name = ?", (name,)).fetchone()
        if row is None:
            raise BranchNotFound(f"branch '{name}' not found")
        return self._row_to_branch(row)

    def list_branches(self, include_deleted: bool = False) -> list[Branch]:
        where = "" if include_deleted else " WHERE deleted_at IS NULL"
        rows = self._conn.execute(f"SELECT * FROM branches{where} ORDER BY name").fetchall()
        return [self._row_to_branch(row) for row in rows]

    def list_trashed_branches(self) -> list[Branch]:
        """Branches moved to Storage (trash), newest first."""
        rows = self._conn.execute(
            "SELECT * FROM branches WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC"
        ).fetchall()
        return [self._row_to_branch(row) for row in rows]

    def soft_delete_branch(self, name: str, deleted_at: str) -> None:
        """Move a branch to Storage without dropping its pointer."""
        with self._conn:
            cur = self._conn.execute(
                "UPDATE branches SET deleted_at = ? WHERE name = ?", (deleted_at, name)
            )
            if cur.rowcount == 0:
                raise BranchNotFound(f"branch '{name}' not found")

    def restore_branch(self, name: str) -> None:
        with self._conn:
            cur = self._conn.execute(
                "UPDATE branches SET deleted_at = NULL WHERE name = ?", (name,)
            )
            if cur.rowcount == 0:
                raise BranchNotFound(f"branch '{name}' not found")

    def branch_is_trashed(self, name: str) -> bool:
        row = self._conn.execute(
            "SELECT deleted_at FROM branches WHERE name = ?", (name,)
        ).fetchone()
        return row is not None and row["deleted_at"] is not None

    def update_branch_head(
        self, name: str, head_commit_id: str, expected_head_id: str | None = None
    ) -> None:
        with self._conn:
            if expected_head_id is None:
                cur = self._conn.execute(
                    "UPDATE branches SET head_commit_id = ? WHERE name = ?",
                    (head_commit_id, name),
                )
            else:
                cur = self._conn.execute(
                    "UPDATE branches SET head_commit_id = ? "
                    "WHERE name = ? AND head_commit_id = ?",
                    (head_commit_id, name, expected_head_id),
                )
            if cur.rowcount == 0:
                if expected_head_id is not None and self._conn.execute(
                    "SELECT 1 FROM branches WHERE name = ?", (name,)
                ).fetchone() is not None:
                    from contextgit.core.errors import StaleMergePreview

                    raise StaleMergePreview(f"branch '{name}' moved while it was being updated")
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

    # ---------- sessions ----------

    @staticmethod
    def _row_to_session(row: sqlite3.Row) -> Session:
        return Session(
            id=row["id"],
            name=row["name"],
            kind=cast("SessionKind", row["kind"]),
            branch=row["branch"],
            status=cast("SessionStatus", row["status"]),
            agent=row["agent"],
            auto_commit=bool(row["auto_commit"]),
            worktree_path=row["worktree_path"],
            git_branch=row["git_branch"],
            base_ref=row["base_ref"],
            base_commit=row["base_commit"],
            project_path=row["project_path"],
            task=row["task"],
            scope=json.loads(row["scope"]) if row["scope"] else [],
            role=row["role"],
            skills=json.loads(row["skills"]) if row["skills"] else [],
            port=row["port"],
            deleted_at=row["deleted_at"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def insert_session(self, session: Session) -> None:
        with self._conn:
            self._conn.execute(
                "INSERT INTO sessions"
                " (id, name, kind, branch, status, agent, auto_commit, worktree_path,"
                " git_branch, base_ref, base_commit, project_path, task, scope, role,"
                " skills, port, deleted_at, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    session.id,
                    session.name,
                    session.kind,
                    session.branch,
                    session.status,
                    session.agent,
                    int(session.auto_commit),
                    session.worktree_path,
                    session.git_branch,
                    session.base_ref,
                    session.base_commit,
                    session.project_path,
                    session.task,
                    json.dumps(session.scope),
                    session.role,
                    json.dumps(session.skills),
                    session.port,
                    session.deleted_at.isoformat() if session.deleted_at else None,
                    session.created_at.isoformat(),
                    session.updated_at.isoformat(),
                ),
            )

    def get_session(self, session_id: str) -> Session:
        row = self._conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if row is None:
            raise SessionNotFound(f"session '{session_id[:12]}' not found")
        return self._row_to_session(row)

    def list_sessions(self, include_deleted: bool = False) -> list[Session]:
        where = "" if include_deleted else " WHERE deleted_at IS NULL"
        rows = self._conn.execute(f"SELECT * FROM sessions{where} ORDER BY created_at").fetchall()
        return [self._row_to_session(row) for row in rows]

    def list_trashed_sessions(self) -> list[Session]:
        """Sessions moved to Storage (trash), newest first."""
        rows = self._conn.execute(
            "SELECT * FROM sessions WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC"
        ).fetchall()
        return [self._row_to_session(row) for row in rows]

    def update_session(self, session: Session) -> None:
        """Persist all mutable session fields (id is the key)."""
        with self._conn:
            cur = self._conn.execute(
                "UPDATE sessions SET name = ?, branch = ?, status = ?, agent = ?,"
                " auto_commit = ?, worktree_path = ?, git_branch = ?, base_ref = ?,"
                " base_commit = ?, project_path = ?, task = ?, scope = ?, role = ?,"
                " skills = ?, port = ?, deleted_at = ?, updated_at = ? WHERE id = ?",
                (
                    session.name,
                    session.branch,
                    session.status,
                    session.agent,
                    int(session.auto_commit),
                    session.worktree_path,
                    session.git_branch,
                    session.base_ref,
                    session.base_commit,
                    session.project_path,
                    session.task,
                    json.dumps(session.scope),
                    session.role,
                    json.dumps(session.skills),
                    session.port,
                    session.deleted_at.isoformat() if session.deleted_at else None,
                    session.updated_at.isoformat(),
                    session.id,
                ),
            )
            if cur.rowcount == 0:
                raise SessionNotFound(f"session '{session.id[:12]}' not found")

    def delete_session(self, session_id: str) -> None:
        """Permanently delete a session and its staged messages; commits/branches survive."""
        with self._conn:
            cur = self._conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            if cur.rowcount == 0:
                raise SessionNotFound(f"session '{session_id[:12]}' not found")

    # ---------- staging ----------

    def append_staged(self, session_id: str, messages: list[Message]) -> None:
        """Append messages to a session's staging buffer (not commits yet)."""
        with self._conn:
            row = self._conn.execute(
                "SELECT COALESCE(MAX(seq), -1) + 1 FROM staging WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            seq = int(row[0])
            for offset, msg in enumerate(messages):
                self._conn.execute(
                    "INSERT INTO staging (session_id, seq, role, content, created_at)"
                    " VALUES (?, ?, ?, ?, ?)",
                    (session_id, seq + offset, msg.role, msg.content, msg.created_at.isoformat()),
                )

    def staged_messages(self, session_id: str) -> list[Message]:
        rows = self._conn.execute(
            "SELECT role, content, created_at FROM staging WHERE session_id = ? ORDER BY seq",
            (session_id,),
        ).fetchall()
        return [
            Message(
                role=cast("Role", row["role"]), content=row["content"], created_at=row["created_at"]
            )
            for row in rows
        ]

    def clear_staged(self, session_id: str) -> None:
        with self._conn:
            self._conn.execute("DELETE FROM staging WHERE session_id = ?", (session_id,))

    def unstage_last(self, session_id: str) -> Message | None:
        """Remove and return the newest staged message, or None if empty."""
        with self._conn:
            row = self._conn.execute(
                "SELECT seq, role, content, created_at FROM staging WHERE session_id = ?"
                " ORDER BY seq DESC LIMIT 1",
                (session_id,),
            ).fetchone()
            if row is None:
                return None
            self._conn.execute(
                "DELETE FROM staging WHERE session_id = ? AND seq = ?", (session_id, row["seq"])
            )
        return Message(
            role=cast("Role", row["role"]), content=row["content"], created_at=row["created_at"]
        )

    # ---------- claims (file scope owned by a run) ----------

    def insert_claims(self, session_id: str, globs: list[str], created_at: str) -> None:
        with self._conn:
            for glob in globs:
                self._conn.execute(
                    "INSERT OR IGNORE INTO claims (session_id, path_glob, created_at)"
                    " VALUES (?, ?, ?)",
                    (session_id, glob, created_at),
                )

    def delete_claims(self, session_id: str) -> None:
        with self._conn:
            self._conn.execute("DELETE FROM claims WHERE session_id = ?", (session_id,))

    def session_claims(self, session_id: str) -> list[str]:
        rows = self._conn.execute(
            "SELECT path_glob FROM claims WHERE session_id = ? ORDER BY path_glob",
            (session_id,),
        ).fetchall()
        return [str(row["path_glob"]) for row in rows]

    def claims_by_session(self) -> dict[str, list[str]]:
        """Every session's claimed globs, keyed by session id."""
        rows = self._conn.execute(
            "SELECT session_id, path_glob FROM claims ORDER BY session_id, path_glob"
        ).fetchall()
        result: dict[str, list[str]] = {}
        for row in rows:
            result.setdefault(str(row["session_id"]), []).append(str(row["path_glob"]))
        return result

    # ---------- merge queue ----------

    @staticmethod
    def _row_to_merge_entry(row: sqlite3.Row) -> MergeQueueEntry:
        return MergeQueueEntry(
            id=int(row["id"]),
            session_id=row["session_id"],
            target=row["target"],
            position=int(row["position"]),
            status=cast("MergeStatus", row["status"]),
            conflicts=json.loads(row["conflicts"]) if row["conflicts"] else [],
            commit_id=row["commit_id"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def insert_merge_entry(
        self, session_id: str, target: str, position: int, created_at: str
    ) -> MergeQueueEntry:
        with self._conn:
            cur = self._conn.execute(
                "INSERT INTO merge_queue"
                " (session_id, target, position, status, conflicts, commit_id, created_at,"
                " updated_at) VALUES (?, ?, ?, 'queued', NULL, NULL, ?, ?)",
                (session_id, target, position, created_at, created_at),
            )
        return self.get_merge_entry(int(cur.lastrowid or 0))

    def get_merge_entry(self, entry_id: int) -> MergeQueueEntry:
        row = self._conn.execute("SELECT * FROM merge_queue WHERE id = ?", (entry_id,)).fetchone()
        if row is None:
            raise MergeQueueEntryNotFound(f"merge queue entry {entry_id} not found")
        return self._row_to_merge_entry(row)

    def list_merge_entries(self) -> list[MergeQueueEntry]:
        rows = self._conn.execute("SELECT * FROM merge_queue ORDER BY position, id").fetchall()
        return [self._row_to_merge_entry(row) for row in rows]

    def update_merge_entry(self, entry: MergeQueueEntry) -> None:
        with self._conn:
            cur = self._conn.execute(
                "UPDATE merge_queue SET target = ?, position = ?, status = ?, conflicts = ?,"
                " commit_id = ?, updated_at = ? WHERE id = ?",
                (
                    entry.target,
                    entry.position,
                    entry.status,
                    json.dumps(entry.conflicts),
                    entry.commit_id,
                    entry.updated_at.isoformat(),
                    entry.id,
                ),
            )
            if cur.rowcount == 0:
                raise MergeQueueEntryNotFound(f"merge queue entry {entry.id} not found")

    def next_merge_position(self) -> int:
        row = self._conn.execute(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM merge_queue"
        ).fetchone()
        return int(row[0])

    def delete_merge_entry(self, entry_id: int) -> None:
        with self._conn:
            cur = self._conn.execute("DELETE FROM merge_queue WHERE id = ?", (entry_id,))
            if cur.rowcount == 0:
                raise MergeQueueEntryNotFound(f"merge queue entry {entry_id} not found")

    # ---------- team mode (missions, tasks, deps, board feed) ----------

    @staticmethod
    def _row_to_team(row: sqlite3.Row) -> Team:
        return Team(
            id=row["id"],
            name=row["name"],
            project_path=row["project_path"],
            base_ref=row["base_ref"],
            gate_command=row["gate_command"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def insert_team(self, team: Team) -> None:
        with self._conn:
            self._conn.execute(
                "INSERT INTO teams"
                " (id, name, project_path, base_ref, gate_command, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    team.id,
                    team.name,
                    team.project_path,
                    team.base_ref,
                    team.gate_command,
                    team.created_at.isoformat(),
                    team.updated_at.isoformat(),
                ),
            )

    def get_team(self, team_id: str) -> Team:
        row = self._conn.execute("SELECT * FROM teams WHERE id = ?", (team_id,)).fetchone()
        if row is None:
            raise TeamNotFound(f"team '{team_id[:12]}' not found")
        return self._row_to_team(row)

    def list_teams(self) -> list[Team]:
        rows = self._conn.execute("SELECT * FROM teams ORDER BY created_at").fetchall()
        return [self._row_to_team(row) for row in rows]

    def update_team(self, team: Team) -> None:
        with self._conn:
            cur = self._conn.execute(
                "UPDATE teams SET name = ?, project_path = ?, base_ref = ?, gate_command = ?,"
                " updated_at = ? WHERE id = ?",
                (
                    team.name,
                    team.project_path,
                    team.base_ref,
                    team.gate_command,
                    team.updated_at.isoformat(),
                    team.id,
                ),
            )
            if cur.rowcount == 0:
                raise TeamNotFound(f"team '{team.id[:12]}' not found")

    def delete_team(self, team_id: str) -> None:
        with self._conn:
            cur = self._conn.execute("DELETE FROM teams WHERE id = ?", (team_id,))
            if cur.rowcount == 0:
                raise TeamNotFound(f"team '{team_id[:12]}' not found")

    @staticmethod
    def _row_to_task(row: sqlite3.Row) -> Task:
        # depends_on / blocked_by / tokens are derived in Repo, not stored.
        return Task(
            id=row["id"],
            team_id=row["team_id"],
            title=row["title"],
            brief=row["brief"],
            done_criteria=row["done_criteria"],
            role=row["role"],
            status=cast("TaskStatus", row["status"]),
            agent=row["agent"],
            session_id=row["session_id"],
            scope=json.loads(row["scope"]) if row["scope"] else [],
            contract=row["contract"],
            position=int(row["position"]),
            gate_command=row["gate_command"],
            gate_status=cast("Literal['pass', 'fail'] | None", row["gate_status"]),
            gate_exit_code=row["gate_exit_code"],
            gate_output=row["gate_output"],
            gate_ran_at=row["gate_ran_at"],
            verifier_session_id=row["verifier_session_id"],
            review_note=row["review_note"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def insert_task(self, task: Task) -> None:
        with self._conn:
            self._conn.execute(
                "INSERT INTO tasks"
                " (id, team_id, title, brief, done_criteria, role, status, agent, session_id,"
                " scope, contract, position, gate_command, gate_status, gate_exit_code,"
                " gate_output, gate_ran_at, verifier_session_id, review_note, created_at,"
                " updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    task.id,
                    task.team_id,
                    task.title,
                    task.brief,
                    task.done_criteria,
                    task.role,
                    task.status,
                    task.agent,
                    task.session_id,
                    json.dumps(task.scope),
                    task.contract,
                    task.position,
                    task.gate_command,
                    task.gate_status,
                    task.gate_exit_code,
                    task.gate_output,
                    task.gate_ran_at.isoformat() if task.gate_ran_at else None,
                    task.verifier_session_id,
                    task.review_note,
                    task.created_at.isoformat(),
                    task.updated_at.isoformat(),
                ),
            )

    def get_task(self, task_id: str) -> Task:
        row = self._conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if row is None:
            raise TaskNotFound(f"task '{task_id[:12]}' not found")
        return self._row_to_task(row)

    def list_tasks(self, team_id: str) -> list[Task]:
        rows = self._conn.execute(
            "SELECT * FROM tasks WHERE team_id = ? ORDER BY position, created_at", (team_id,)
        ).fetchall()
        return [self._row_to_task(row) for row in rows]

    def update_task(self, task: Task) -> None:
        with self._conn:
            cur = self._conn.execute(
                "UPDATE tasks SET title = ?, brief = ?, done_criteria = ?, role = ?, status = ?,"
                " agent = ?, session_id = ?, scope = ?, contract = ?, position = ?,"
                " gate_command = ?, gate_status = ?, gate_exit_code = ?, gate_output = ?,"
                " gate_ran_at = ?, verifier_session_id = ?, review_note = ?, updated_at = ?"
                " WHERE id = ?",
                (
                    task.title,
                    task.brief,
                    task.done_criteria,
                    task.role,
                    task.status,
                    task.agent,
                    task.session_id,
                    json.dumps(task.scope),
                    task.contract,
                    task.position,
                    task.gate_command,
                    task.gate_status,
                    task.gate_exit_code,
                    task.gate_output,
                    task.gate_ran_at.isoformat() if task.gate_ran_at else None,
                    task.verifier_session_id,
                    task.review_note,
                    task.updated_at.isoformat(),
                    task.id,
                ),
            )
            if cur.rowcount == 0:
                raise TaskNotFound(f"task '{task.id[:12]}' not found")

    def delete_task(self, task_id: str) -> None:
        with self._conn:
            cur = self._conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
            if cur.rowcount == 0:
                raise TaskNotFound(f"task '{task_id[:12]}' not found")

    def next_task_position(self, team_id: str) -> int:
        row = self._conn.execute(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM tasks WHERE team_id = ?", (team_id,)
        ).fetchone()
        return int(row[0])

    def add_task_dep(self, task_id: str, depends_on_task_id: str) -> None:
        with self._conn:
            self._conn.execute(
                "INSERT OR IGNORE INTO task_deps (task_id, depends_on_task_id) VALUES (?, ?)",
                (task_id, depends_on_task_id),
            )

    def remove_task_dep(self, task_id: str, depends_on_task_id: str) -> None:
        with self._conn:
            self._conn.execute(
                "DELETE FROM task_deps WHERE task_id = ? AND depends_on_task_id = ?",
                (task_id, depends_on_task_id),
            )

    def task_deps(self, team_id: str) -> dict[str, list[str]]:
        """Every task's dependency ids for one team, keyed by task id."""
        rows = self._conn.execute(
            "SELECT d.task_id, d.depends_on_task_id FROM task_deps d"
            " JOIN tasks t ON t.id = d.task_id WHERE t.team_id = ?"
            " ORDER BY d.task_id, d.depends_on_task_id",
            (team_id,),
        ).fetchall()
        result: dict[str, list[str]] = {}
        for row in rows:
            result.setdefault(str(row["task_id"]), []).append(str(row["depends_on_task_id"]))
        return result

    def tasks_depending_on(self, task_id: str) -> list[str]:
        """Task ids that directly depend on `task_id`."""
        rows = self._conn.execute(
            "SELECT task_id FROM task_deps WHERE depends_on_task_id = ? ORDER BY task_id",
            (task_id,),
        ).fetchall()
        return [str(row["task_id"]) for row in rows]

    @staticmethod
    def _row_to_team_message(row: sqlite3.Row) -> TeamMessage:
        return TeamMessage(
            id=int(row["id"]),
            team_id=row["team_id"],
            task_id=row["task_id"],
            from_task_id=row["from_task_id"],
            kind=cast("TeamMessageKind", row["kind"]),
            body=row["body"],
            created_at=row["created_at"],
        )

    def insert_team_message(self, message: TeamMessage) -> TeamMessage:
        with self._conn:
            cur = self._conn.execute(
                "INSERT INTO team_messages (team_id, task_id, from_task_id, kind, body,"
                " created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    message.team_id,
                    message.task_id,
                    message.from_task_id,
                    message.kind,
                    message.body,
                    message.created_at.isoformat(),
                ),
            )
        return self.get_team_message(int(cur.lastrowid or 0))

    def get_team_message(self, message_id: int) -> TeamMessage:
        row = self._conn.execute(
            "SELECT * FROM team_messages WHERE id = ?", (message_id,)
        ).fetchone()
        if row is None:
            raise TaskNotFound(f"team message {message_id} not found")
        return self._row_to_team_message(row)

    def list_team_messages(self, team_id: str, limit: int | None = None) -> list[TeamMessage]:
        sql = "SELECT * FROM team_messages WHERE team_id = ? ORDER BY id"
        rows = self._conn.execute(sql, (team_id,)).fetchall()
        messages = [self._row_to_team_message(row) for row in rows]
        return messages[-limit:] if limit is not None else messages

    def insert_team_event(self, event: TeamEvent) -> None:
        with self._conn:
            self._conn.execute(
                "INSERT INTO team_events (team_id, kind, task_id, payload, created_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (
                    event.team_id,
                    event.kind,
                    event.task_id,
                    json.dumps(event.payload),
                    event.created_at.isoformat(),
                ),
            )

    # ---------- providers (locally stored LLM endpoints) ----------

    @staticmethod
    def _row_to_provider(row: sqlite3.Row) -> ProviderRecord:
        return ProviderRecord(
            id=row["id"],
            label=row["label"],
            vendor=row["vendor"],
            kind=cast("ProviderKind", row["kind"]),
            capability=cast("ProviderCapability", row["capability"]),
            base_url=row["base_url"],
            auth_style=cast("AuthStyle", row["auth_style"]),
            api_key=row["api_key"],
            default_model=row["default_model"],
            models=json.loads(row["models_json"]) if row["models_json"] else [],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def _upsert_provider_row(self, table: str, record: ProviderRecord) -> ProviderRecord:
        """Insert or replace a provider row; `api_key=None` clears a stored key."""
        with self._conn:
            self._conn.execute(
                f"INSERT INTO {table}"
                " (id, label, vendor, kind, capability, base_url, auth_style, api_key,"
                " default_model, models_json, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                " ON CONFLICT(id) DO UPDATE SET label = excluded.label,"
                " vendor = excluded.vendor, kind = excluded.kind,"
                " capability = excluded.capability, base_url = excluded.base_url,"
                " auth_style = excluded.auth_style, api_key = excluded.api_key,"
                " default_model = excluded.default_model, models_json = excluded.models_json,"
                " updated_at = excluded.updated_at",
                (
                    record.id,
                    record.label,
                    record.vendor,
                    record.kind,
                    record.capability,
                    record.base_url,
                    record.auth_style,
                    record.api_key,
                    record.default_model,
                    json.dumps(record.models),
                    record.created_at.isoformat(),
                    record.updated_at.isoformat(),
                ),
            )
        return self._get_provider_row(table, record.id)  # type: ignore[return-value]

    def _get_provider_row(self, table: str, provider_id: str) -> ProviderRecord | None:
        row = self._conn.execute(
            f"SELECT * FROM {table} WHERE id = ?", (provider_id,)
        ).fetchone()
        return self._row_to_provider(row) if row is not None else None

    def _list_provider_rows(self, table: str) -> list[ProviderRecord]:
        rows = self._conn.execute(f"SELECT * FROM {table} ORDER BY id").fetchall()
        return [self._row_to_provider(row) for row in rows]

    def _delete_provider_row(self, table: str, provider_id: str) -> bool:
        with self._conn:
            cur = self._conn.execute(f"DELETE FROM {table} WHERE id = ?", (provider_id,))
        return cur.rowcount > 0

    def upsert_provider(self, record: ProviderRecord) -> ProviderRecord:
        """Insert or replace a Chat provider row."""
        return self._upsert_provider_row("providers", record)

    def get_provider_row(self, provider_id: str) -> ProviderRecord | None:
        """One stored Chat provider row, or None."""
        return self._get_provider_row("providers", provider_id)

    def list_provider_rows(self) -> list[ProviderRecord]:
        """Every stored Chat provider row."""
        return self._list_provider_rows("providers")

    def delete_provider_row(self, provider_id: str) -> bool:
        """Remove a Chat provider row."""
        return self._delete_provider_row("providers", provider_id)

    def upsert_agent_provider(self, record: ProviderRecord) -> ProviderRecord:
        """Insert or replace an asset-agent provider row (its own store)."""
        return self._upsert_provider_row("agent_providers", record)

    def get_agent_provider_row(self, provider_id: str) -> ProviderRecord | None:
        """One stored asset-agent provider row, or None."""
        return self._get_provider_row("agent_providers", provider_id)

    def list_agent_provider_rows(self) -> list[ProviderRecord]:
        """Every stored asset-agent provider row."""
        return self._list_provider_rows("agent_providers")

    def delete_agent_provider_row(self, provider_id: str) -> bool:
        """Remove an asset-agent provider row."""
        return self._delete_provider_row("agent_providers", provider_id)

    # ---------- API tab history ----------

    def record_http_history(
        self, method: str, url: str, status: int, elapsed_ms: int, size: int
    ) -> None:
        """Append one executed request to the history."""
        with self._conn:
            self._conn.execute(
                "INSERT INTO http_history (method, url, status, elapsed_ms, size, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (method, url, status, elapsed_ms, size, utcnow().isoformat()),
            )

    def list_http_history(self, limit: int = 50) -> list[sqlite3.Row]:
        """The most recent executed requests, newest first."""
        return self._conn.execute(
            "SELECT id, method, url, status, elapsed_ms, size, created_at FROM http_history"
            " ORDER BY id DESC LIMIT ?",
            (max(1, min(limit, 500)),),
        ).fetchall()

    # ---------- run environments (names + hashes, never values) ----------

    def record_run_env(self, session_id: str, entries: list[EnvEntry]) -> None:
        """Store what environment a run had."""
        with self._conn:
            self._conn.executemany(
                "INSERT OR REPLACE INTO run_env (session_id, key, hash, source)"
                " VALUES (?, ?, ?, ?)",
                [(session_id, entry.key, entry.hash, entry.source) for entry in entries],
            )

    def list_run_env(self, session_id: str) -> list[sqlite3.Row]:
        """One run's variables, alphabetically."""
        return self._conn.execute(
            "SELECT key, hash, source FROM run_env WHERE session_id = ? ORDER BY key",
            (session_id,),
        ).fetchall()

    # ---------- usage (token accounting) ----------

    @staticmethod
    def _row_to_usage(row: sqlite3.Row) -> UsageEvent:
        return UsageEvent(
            provider=row["provider"],
            model=row["model"],
            surface=cast("UsageSurface", row["surface"]),
            source=cast("UsageSource", row["source"]),
            prompt_tokens=row["prompt_tokens"],
            completion_tokens=row["completion_tokens"],
            total_tokens=row["total_tokens"],
            session_id=row["session_id"],
            branch=row["branch"],
            created_at=row["created_at"],
        )

    def insert_usage(self, event: UsageEvent) -> None:
        with self._conn:
            self._conn.execute(
                "INSERT INTO usage_events"
                " (provider, model, surface, source, prompt_tokens, completion_tokens,"
                " total_tokens, session_id, branch, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    event.provider,
                    event.model,
                    event.surface,
                    event.source,
                    event.prompt_tokens,
                    event.completion_tokens,
                    event.total_tokens,
                    event.session_id,
                    event.branch,
                    event.created_at.isoformat(),
                ),
            )

    def list_usage(self, since: str | None = None) -> list[UsageEvent]:
        """Every usage event, or only those created at/after an ISO timestamp."""
        if since is None:
            rows = self._conn.execute("SELECT * FROM usage_events ORDER BY id").fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM usage_events WHERE created_at >= ? ORDER BY id", (since,)
            ).fetchall()
        return [self._row_to_usage(row) for row in rows]

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

    def is_initialized(self) -> bool:
        """True once the repository has a HEAD (root commit + branch written)."""
        return self._conn.execute("SELECT 1 FROM repo_state WHERE id = 1").fetchone() is not None
