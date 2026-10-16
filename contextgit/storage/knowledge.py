"""Knowledge persistence shares the repository's transaction lock."""

from contextgit.knowledge.models import Checkpoint, Lesson
from contextgit.storage.connection import _GuardedConnection


class KnowledgeStorage:
    def __init__(self, connection: _GuardedConnection):
        self.connection = connection

    def save(self, value: Checkpoint | Lesson) -> None:
        kind = "checkpoint" if isinstance(value, Checkpoint) else "lesson"
        with self.connection:
            self.connection.execute(
                "INSERT INTO knowledge_records VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, "
                "updated_at=excluded.updated_at",
                (
                    value.id,
                    value.session_id,
                    value.project_path,
                    kind,
                    value.model_dump_json(),
                    value.updated_at,
                ),
            )

    def list(self, project: str, kind: str) -> list[Checkpoint | Lesson]:
        model = Checkpoint if kind == "checkpoint" else Lesson
        return [
            model.model_validate_json(row[0])
            for row in self.connection.execute(
                "SELECT payload FROM knowledge_records WHERE project_path=? AND kind=? "
                "ORDER BY updated_at DESC, id",
                (project, kind),
            )
        ]

    def get(self, identity: str, kind: str) -> Checkpoint | Lesson | None:
        row = self.connection.execute(
            "SELECT payload FROM knowledge_records WHERE id=? AND kind=?", (identity, kind)
        ).fetchone()
        model = Checkpoint if kind == "checkpoint" else Lesson
        return model.model_validate_json(row[0]) if row else None
