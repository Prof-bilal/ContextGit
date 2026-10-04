"""SQLite-backed storage. The only code that talks SQL.

Schema changes require a numbered migration in storage/migrations/ applied
in filename order; the applied set is recorded in schema_version (one row
per applied migration number).
"""

import json
import sqlite3
from importlib import resources
from pathlib import Path
from typing import Literal, cast

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
)

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
        # FastAPI handlers and TestClient can execute requests on a different thread.
        # SQLite serializes operations on this connection; API uses one worker by default.
        self._conn = sqlite3.connect(self._db_path, check_same_thread=False)
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
            task=row["task"],
            scope=json.loads(row["scope"]) if row["scope"] else [],
            port=row["port"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def insert_session(self, session: Session) -> None:
        with self._conn:
            self._conn.execute(
                "INSERT INTO sessions"
                " (id, name, kind, branch, status, agent, auto_commit, worktree_path,"
                " git_branch, base_ref, base_commit, task, scope, port, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
                    session.task,
                    json.dumps(session.scope),
                    session.port,
                    session.created_at.isoformat(),
                    session.updated_at.isoformat(),
                ),
            )

    def get_session(self, session_id: str) -> Session:
        row = self._conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if row is None:
            raise SessionNotFound(f"session '{session_id[:12]}' not found")
        return self._row_to_session(row)

    def list_sessions(self) -> list[Session]:
        rows = self._conn.execute("SELECT * FROM sessions ORDER BY created_at").fetchall()
        return [self._row_to_session(row) for row in rows]

    def update_session(self, session: Session) -> None:
        """Persist all mutable session fields (id is the key)."""
        with self._conn:
            cur = self._conn.execute(
                "UPDATE sessions SET name = ?, branch = ?, status = ?, agent = ?,"
                " auto_commit = ?, worktree_path = ?, git_branch = ?, base_ref = ?,"
                " base_commit = ?, task = ?, scope = ?, port = ?, updated_at = ? WHERE id = ?",
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
                    session.task,
                    json.dumps(session.scope),
                    session.port,
                    session.updated_at.isoformat(),
                    session.id,
                ),
            )
            if cur.rowcount == 0:
                raise SessionNotFound(f"session '{session.id[:12]}' not found")

    def delete_session(self, session_id: str) -> None:
        """Delete a session and its staged messages; commits/branches survive."""
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

    def upsert_provider(self, record: ProviderRecord) -> ProviderRecord:
        """Insert or replace a provider row; `api_key=None` clears a stored key."""
        with self._conn:
            self._conn.execute(
                "INSERT INTO providers"
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
        return self.get_provider_row(record.id)  # type: ignore[return-value]

    def get_provider_row(self, provider_id: str) -> ProviderRecord | None:
        row = self._conn.execute(
            "SELECT * FROM providers WHERE id = ?", (provider_id,)
        ).fetchone()
        return self._row_to_provider(row) if row is not None else None

    def list_provider_rows(self) -> list[ProviderRecord]:
        rows = self._conn.execute("SELECT * FROM providers ORDER BY id").fetchall()
        return [self._row_to_provider(row) for row in rows]

    def delete_provider_row(self, provider_id: str) -> bool:
        with self._conn:
            cur = self._conn.execute("DELETE FROM providers WHERE id = ?", (provider_id,))
        return cur.rowcount > 0

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
