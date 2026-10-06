"""Models for the Chat "Document" mode (generate a file on a topic)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# Markdown always works; the others need an optional renderer library.
DocumentFormat = Literal["md", "pdf", "docx", "pptx"]
# A house style: formal report, tight brief, or an accent-coloured proposal.
DocumentTemplate = Literal["report", "brief", "proposal"]
BlockKind = Literal[
    "heading", "paragraph", "bullets", "ordered", "code", "table", "quote", "rule"
]

DOCUMENT_EXTENSIONS: dict[str, str] = {
    "md": "md",
    "pdf": "pdf",
    "docx": "docx",
    "pptx": "pptx",
}


class Block(BaseModel):
    """One block of document body, normalized from the model's markdown."""

    kind: BlockKind
    # heading / paragraph / quote text.
    text: str = ""
    # bullets / ordered items.
    items: list[str] = Field(default_factory=list)
    # heading level (1-3).
    level: int = 1
    # code: the language tag and the lines.
    lang: str | None = None
    lines: list[str] = Field(default_factory=list)
    # table: rows, the first being the header.
    rows: list[list[str]] = Field(default_factory=list)


class Slide(BaseModel):
    """One PowerPoint slide."""

    title: str
    bullets: list[str] = Field(default_factory=list)


class DocumentContent(BaseModel):
    """A generated document, normalized enough to render in any format."""

    title: str
    subtitle: str | None = None
    template: DocumentTemplate = "report"
    markdown: str
    blocks: list[Block] = Field(default_factory=list)
    slides: list[Slide] = Field(default_factory=list)


class RenderedDocument(BaseModel):
    """A rendered file on disk, ready to download."""

    id: str
    filename: str
    format: DocumentFormat
    size: int
    title: str
    markdown: str


class DocumentInfo(BaseModel):
    """A previously generated document, for the Docs library list."""

    id: str
    filename: str
    format: DocumentFormat
    size: int
    title: str
    created_at: datetime
