"""Structured models for a research run: the plan, the evidence, the presents.

Everything a model returns is validated here (Pydantic), so a run either yields
a schema-correct artifact or degrades to an empty one — never a malformed report.
"""

from typing import Literal

from pydantic import BaseModel, Field


class ResearchPlan(BaseModel):
    """The sub-questions a run will pursue."""

    sub_questions: list[str] = Field(default_factory=list)


class Extraction(BaseModel):
    """What a reading pass pulled from the fetched pages."""

    learnings: list[str] = Field(default_factory=list)
    follow_up_questions: list[str] = Field(default_factory=list)


class Claims(BaseModel):
    """Checkable claims pulled from a branch's context (for a verification pass)."""

    claims: list[str] = Field(default_factory=list)


class Source(BaseModel):
    """One cited page: the snapshot is stored alongside the run for auditing."""

    id: int
    title: str
    url: str
    host: str
    fetched_at: str


class ComparisonRow(BaseModel):
    """One competitor in a comparison matrix; every cell carries a source id."""

    competitor: str
    pricing: str = ""
    positioning: str = ""
    features: list[str] = Field(default_factory=list)
    target: str = ""
    weaknesses: list[str] = Field(default_factory=list)
    sources: list[int] = Field(default_factory=list)


class ComparisonResult(BaseModel):
    """Competitive research output: a matrix, not prose."""

    rows: list[ComparisonRow] = Field(default_factory=list)
    how_we_differ: str = ""


class LeadSignal(BaseModel):
    """One public signal about a company/person, tied to its source."""

    kind: str
    detail: str
    source_id: int | None = None


class LeadResult(BaseModel):
    """Lead research output — public sources only, no contacts."""

    name: str = ""
    website: str = ""
    description: str = ""
    signals: list[LeadSignal] = Field(default_factory=list)


class Verdict(BaseModel):
    """One claim checked against independent sources."""

    claim: str
    verdict: Literal["supported", "contradicted", "unverifiable"] = "unverifiable"
    evidence: str = ""
    source_id: int | None = None


class VerifyResult(BaseModel):
    """Verification output: a verdict per claim."""

    verdicts: list[Verdict] = Field(default_factory=list)
