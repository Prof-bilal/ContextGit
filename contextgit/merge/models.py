"""Structured values used by the pure diff and merge engine."""

from typing import Literal

from pydantic import BaseModel, Field

from contextgit.core.models import Message


class SemanticConflict(BaseModel):
    """A contradictory source/target decision or fact that needs user input."""

    id: str
    category: Literal["decision", "fact"]
    topic: str
    source: str
    target: str


class SemanticExtraction(BaseModel):
    """Meaning extracted from branch changes, validated at the LLM boundary."""

    decisions: list[str] = Field(default_factory=list)
    facts: list[str] = Field(default_factory=list)
    dead_ends: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    conflicts: list[SemanticConflict] = Field(default_factory=list)
    summary: str = ""


class Diff(BaseModel):
    """Messages introduced on each side since the common ancestor."""

    ancestor_id: str
    a_id: str
    b_id: str
    a_messages: list[Message]
    b_messages: list[Message]
    a_token_count: int
    b_token_count: int

    @property
    def token_delta(self) -> int:
        """Token count on side B minus side A."""
        return self.b_token_count - self.a_token_count


class MergePreview(BaseModel):
    """An immutable proposal suitable for showing and later approving."""

    source_branch: str
    target_branch: str
    source_head_id: str
    target_head_id: str
    ancestor_id: str
    extraction: SemanticExtraction
    conflicts: list[SemanticConflict]
    messages: list[Message]
    summary: str
    summary_confidence: Literal["high", "low"]
    fallback: bool = False
