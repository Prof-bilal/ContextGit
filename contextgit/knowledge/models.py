from typing import Literal

from pydantic import BaseModel, Field


class Feedback(BaseModel):
    rating: int | None = Field(default=None, ge=1, le=5)
    tags: list[
        Literal["incorrect", "incomplete", "too slow", "unsafe", "confusing", "excellent"]
    ] = Field(default_factory=list, max_length=6)
    note: str = Field(default="", max_length=4000)
    category: str = Field(default="", max_length=80)


class Checkpoint(BaseModel):
    id: str
    session_id: str
    project_path: str
    digest: str
    name: str
    category: str = ""
    scope: list[str] = Field(default_factory=list)
    markdown: str
    source_markdown: str = ""
    capture_status: str
    warning: str | None = None
    redactions: int = 0
    feedback: Feedback = Field(default_factory=Feedback)
    artifact_path: str | None = None
    updated_at: str


class Lesson(BaseModel):
    id: str
    session_id: str
    checkpoint_id: str
    project_path: str
    category: str = ""
    scope: list[str] = Field(default_factory=list)
    status: Literal["draft", "approved", "rejected"] = "draft"
    title: str = Field(max_length=160)
    instruction: str = Field(max_length=4000)
    rationale: str = Field(max_length=2000)
    evidence: str = Field(max_length=2000)
    confidence: Literal["low", "medium", "high"] = "low"
    kind: Literal["convention", "decision", "rejected approach", "validation", "skill"] = "skill"
    base_memory_revision: int = 0
    source_revision: str = ""
    base_lessons: list[str] = Field(default_factory=list)
    conflicts: list[str] = Field(default_factory=list)
    updated_at: str


class ExportRequest(BaseModel):
    checkpoint_id: str
    markdown: str = Field(max_length=300_000)


class LessonApproval(BaseModel):
    instruction: str = Field(min_length=1, max_length=4000)
    resolve_conflicts: bool = False
