"""Turn a topic into a document: the authoring prompt and markdown -> content."""

import json
import re
from typing import Any

from contextgit.core.models import Message
from contextgit.documents.markdown import parse_markdown
from contextgit.documents.models import (
    Block,
    DocumentContent,
    DocumentFormat,
    DocumentTemplate,
    Slide,
)

_JSON_FENCE = re.compile(r"```json\s*(\{.*?\})\s*```", re.DOTALL)

_SYSTEM = (
    "You are a professional writer producing a polished, ready-to-share document. "
    "Write clear, concise prose for the audience implied by the request.\n"
    "Format the document in markdown, exactly:\n"
    "- Start with a single `#` title on its own line, then a one-line subtitle "
    "as plain text (no `#`).\n"
    "- Then `##` sections (and `###` subsections) with short descriptive titles.\n"
    "- Use real markdown lists only: `-` for bullets, `1.` for numbered steps. "
    "Never use a `#` heading as a list item and never use `•` characters.\n"
    "- Put any code in fenced blocks on their own lines, e.g.\n"
    "```bash\ncommand --flag\n```\n"
    "- Use markdown tables (`| Column | Column |`) for comparisons.\n"
    "Open with a brief executive summary and close with a conclusion or next "
    "steps. Be concrete and factual; never invent sources, statistics, or quotes. "
    "Output only the document: no preamble, and do not wrap the whole document in "
    "a code fence."
)

_TEMPLATE_HINT: dict[DocumentTemplate, str] = {
    "report": "Aim for a thorough report of roughly 800-1500 words.",
    "brief": "Keep it tight and scannable: a one-page brief of roughly 300-500 words.",
    "proposal": "Write it as a persuasive proposal: context, approach, and expected outcomes.",
}

_PPTX_EXTRA = (
    "\n\nAfter the markdown, add a fenced ```json block with a slide outline shaped "
    'as {"title": "...", "slides": [{"title": "...", "bullets": ["...", "..."]}]} '
    "with 5-10 slides, each with 3-5 short bullets."
)


def document_prompt(
    topic: str, fmt: DocumentFormat, template: DocumentTemplate = "report"
) -> list[Message]:
    """The messages sent to the model to author the document."""
    system = f"{_SYSTEM}\n{_TEMPLATE_HINT[template]}"
    user = f"Write a document about:\n\n{topic}"
    if fmt == "pptx":
        user += _PPTX_EXTRA
    return [
        Message(role="system", content=system),
        Message(role="user", content=user),
    ]


def _slides_from_blocks(blocks: list[Block]) -> list[Slide]:
    slides: list[Slide] = []
    current: Slide | None = None
    for block in blocks:
        if block.kind == "heading":
            current = Slide(title=block.text)
            slides.append(current)
        elif block.kind in ("bullets", "ordered") and current is not None:
            current.bullets.extend(block.items)
        elif block.kind in ("paragraph", "quote") and current is not None:
            current.bullets.append(block.text)
    return slides


def _parse_outline(markdown: str) -> tuple[str | None, list[Slide]]:
    match = _JSON_FENCE.search(markdown)
    if not match:
        return None, []
    try:
        data: Any = json.loads(match.group(1))
    except ValueError:
        return None, []
    if not isinstance(data, dict):
        return None, []
    slides: list[Slide] = []
    raw_slides = data.get("slides")
    if isinstance(raw_slides, list):
        for item in raw_slides:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or "").strip()
            raw_bullets = item.get("bullets")
            bullets = (
                [str(entry).strip() for entry in raw_bullets if str(entry).strip()]
                if isinstance(raw_bullets, list)
                else []
            )
            if title or bullets:
                slides.append(Slide(title=title or "Slide", bullets=bullets))
    outline_title = data.get("title")
    return (outline_title if isinstance(outline_title, str) and outline_title else None), slides


def build_document(
    markdown: str, fmt: DocumentFormat, template: DocumentTemplate = "report"
) -> DocumentContent:
    """Normalize the model's markdown into a renderable document."""
    content = parse_markdown(markdown, template=template)
    if fmt != "pptx":
        return content

    outline_title, slides = _parse_outline(markdown)
    if outline_title:
        content.title = outline_title
    if not slides:
        slides = _slides_from_blocks(content.blocks)
    if not slides:
        body = [block.text for block in content.blocks if block.text]
        slides = [Slide(title=content.title, bullets=body or [content.subtitle or ""])]
    content.slides = slides
    return content
