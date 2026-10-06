"""Parse the model's markdown into renderable blocks.

The model's output is *mostly* markdown but full of artefacts — `###` used as
bullet markers, ```` ```lang code ``` ```` inline on one line, numbered steps
glued together, `•`-separated items — so this parser is deliberately forgiving:
it normalizes those into the block kinds the renderers understand.
"""

import re

from contextgit.documents.models import Block, DocumentContent, DocumentTemplate

_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
_BULLET = re.compile(r"^[-*+]\s+(.*)$")
_ORDERED = re.compile(r"^(\d{1,3})[.)]\s+(.*)$")
_FENCE = re.compile(r"^\s*(`{3,}|~{3,})\s*([A-Za-z0-9_+.-]*)\s*$")
_INLINE_FENCE = re.compile(r"^\s*`{3,}\s*([A-Za-z0-9_+.-]*)\s*(.+?)\s*`{3,}\s*$")
_RULE = re.compile(r"^\s*([-*_])(?:\s*\1){2,}\s*$")
_QUOTE = re.compile(r"^\s*>\s?(.*)$")
_TABLE_SEP = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$")
_BULLET_CHARS = "•·▪◦‣"
_TABLE_SPLIT = re.compile(r"\s*\|\s*")
# A fence opened and closed on the same line, anywhere in the line.
_INLINE_ANY = re.compile(r"`{3,}\s*([A-Za-z0-9_+.-]*)\s*(.+?)\s*`{3,}")


def _expand_inline_fences(markdown: str) -> str:
    """`text ```bash cmd ``` more` -> the code block on its own lines."""

    def repl(match: re.Match[str]) -> str:
        lang = match.group(1)
        content = match.group(2).strip()
        return f"\n\n```{lang}\n{content}\n```\n\n"

    return _INLINE_ANY.sub(repl, markdown)


def _clean_inline(text: str) -> str:
    """Strip the leftover bullet/emphasis marks the model sprinkles in."""
    return text.strip().strip("*_ ").strip()


def _bullet_artifacts(text: str) -> list[str]:
    """A heading line used as a bullet list (`### •a •b`) -> ["a", "b"]."""
    parts = re.split(rf"[{re.escape(_BULLET_CHARS)}]", text)
    return [_clean_inline(part) for part in parts if _clean_inline(part)]


def _starts_with_bullet(text: str) -> bool:
    stripped = text.lstrip("*_ ")
    return bool(stripped) and stripped[0] in _BULLET_CHARS


def _table_row(line: str) -> list[str]:
    return [cell.strip() for cell in _TABLE_SPLIT.split(line.strip().strip("|"))]


def parse_markdown(
    markdown: str, *, template: DocumentTemplate = "report"
) -> DocumentContent:
    """Split markdown into a title, subtitle and renderable blocks."""
    lines = _expand_inline_fences(markdown.replace("\r\n", "\n")).split("\n")
    title = ""
    subtitle: str | None = None
    blocks: list[Block] = []
    # Only the line immediately after the title can become the subtitle.
    prev_was_title = False

    paragraph: list[str] = []
    bullets: list[str] = []
    ordered: list[str] = []
    quote: list[str] = []
    table_rows: list[list[str]] = []
    code_lines: list[str] = []
    code_lang: str | None = None
    in_code = False
    open_kind: str | None = None

    def flush() -> None:
        nonlocal paragraph, bullets, ordered, quote, table_rows, open_kind
        if paragraph:
            text = " ".join(paragraph).strip()
            if text:
                blocks.append(Block(kind="paragraph", text=text))
        elif bullets:
            blocks.append(Block(kind="bullets", items=bullets))
        elif ordered:
            blocks.append(Block(kind="ordered", items=ordered))
        elif quote:
            blocks.append(Block(kind="quote", text=" ".join(quote).strip()))
        elif table_rows:
            blocks.append(Block(kind="table", rows=table_rows))
        paragraph, bullets, ordered, quote, table_rows = [], [], [], [], []
        open_kind = None

    for raw in lines:
        line = raw.rstrip()
        stripped = line.strip()

        # Inside a fenced code block: collect until the closing fence.
        if in_code:
            if _FENCE.match(line):
                blocks.append(
                    Block(kind="code", lang=code_lang, lines=list(code_lines))
                )
                in_code = False
                code_lines = []
                code_lang = None
            else:
                code_lines.append(line)
            continue

        if not stripped:
            flush()
            continue

        after_title = prev_was_title
        prev_was_title = False

        # A fence on a single line: ```bash pip install x```
        inline = _INLINE_FENCE.match(line)
        if inline:
            flush()
            content = inline.group(2).strip()
            blocks.append(Block(kind="code", lang=inline.group(1) or None, lines=[content]))
            continue
        fence = _FENCE.match(line)
        if fence:
            flush()
            in_code = True
            code_lang = fence.group(2) or None
            code_lines = []
            continue

        if _RULE.match(stripped):
            flush()
            blocks.append(Block(kind="rule"))
            continue

        # A table: header row + separator + body rows.
        if stripped.startswith("|"):
            if open_kind == "table":
                if not _TABLE_SEP.match(stripped):
                    table_rows.append(_table_row(stripped))
                continue
            flush()
            open_kind = "table"
            if not _TABLE_SEP.match(stripped):
                table_rows.append(_table_row(stripped))
            continue

        heading = _HEADING.match(stripped)
        if heading:
            flush()
            level = len(heading.group(1))
            text = heading.group(2).strip()
            # `###` used as a bullet marker (the model's habit): normalize.
            if _starts_with_bullet(text):
                items = _bullet_artifacts(text)
                if items:
                    open_kind = "bullets"
                    bullets.extend(items)
                    continue
            if level == 1 and not title:
                title = text
                prev_was_title = True
                continue
            blocks.append(Block(kind="heading", text=text, level=min(level, 3)))
            continue

        quote_match = _QUOTE.match(line)
        if quote_match:
            if open_kind != "quote":
                flush()
                open_kind = "quote"
            quote.append(quote_match.group(1).strip())
            continue

        bullet = _BULLET.match(stripped)
        if bullet:
            if open_kind != "bullets":
                flush()
                open_kind = "bullets"
            bullets.append(_clean_inline(bullet.group(1)))
            continue

        ordered_match = _ORDERED.match(stripped)
        if ordered_match:
            if open_kind != "ordered":
                flush()
                open_kind = "ordered"
            ordered.append(_clean_inline(ordered_match.group(2)))
            continue

        # Plain text: the line right under the title becomes the subtitle.
        if after_title and len(stripped) <= 160:
            subtitle = stripped
            continue
        if open_kind != "paragraph":
            flush()
            open_kind = "paragraph"
        paragraph.append(stripped)

    if in_code and code_lines:
        blocks.append(Block(kind="code", lang=code_lang, lines=list(code_lines)))
    flush()

    if not title:
        first = next((block.text for block in blocks if block.text), "")
        title = first[:80] or "Document"
    return DocumentContent(
        title=title,
        subtitle=subtitle,
        template=template,
        markdown=markdown.strip(),
        blocks=blocks,
    )
