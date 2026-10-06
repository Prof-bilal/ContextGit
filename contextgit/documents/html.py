"""DocumentContent -> a self-contained HTML document (the PDF engine's input).

Produces a cover page, a table of contents with real page numbers, running
header/footer with page numbers, and styled body content — all driven by the
chosen house style, via CSS Paged Media (WeasyPrint).
"""

import html as _html
import re
from datetime import date
from string import Template

from contextgit.documents.models import Block, DocumentContent
from contextgit.documents.styles import Style

_INLINE_CODE = re.compile(r"`([^`]+)`")
_BOLD = re.compile(r"\*\*([^*]+)\*\*")
_ITALIC = re.compile(r"(?<!\*)\*([^*\n]+)\*(?!\*)")
_LINK = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")


def _inline(text: str) -> str:
    """Escape HTML, then apply the few inline markdown forms we support."""
    out = _html.escape(text)
    out = _LINK.sub(r'<a href="\2">\1</a>', out)
    out = _INLINE_CODE.sub(r"<code>\1</code>", out)
    out = _BOLD.sub(r"<strong>\1</strong>", out)
    out = _ITALIC.sub(r"<em>\1</em>", out)
    return out


def _block_html(block: Block, section: int) -> str:
    if block.kind == "heading":
        level = 2 if block.level <= 2 else 3
        return f'<h{level} id="sec{section}">{_inline(block.text)}</h{level}>'
    if block.kind == "paragraph":
        return f"<p>{_inline(block.text)}</p>"
    if block.kind == "bullets":
        items = "".join(f"<li>{_inline(item)}</li>" for item in block.items)
        return f"<ul>{items}</ul>"
    if block.kind == "ordered":
        items = "".join(f"<li>{_inline(item)}</li>" for item in block.items)
        return f"<ol>{items}</ol>"
    if block.kind == "code":
        code = _html.escape("\n".join(block.lines))
        lang = f' data-lang="{_html.escape(block.lang)}"' if block.lang else ""
        return f"<pre{lang}><code>{code}</code></pre>"
    if block.kind == "table":
        rows = block.rows
        head = rows[0] if rows else []
        body = rows[1:] if len(rows) > 1 else []
        th = "".join(f"<th>{_inline(cell)}</th>" for cell in head)
        trs = "".join(
            "<tr>" + "".join(f"<td>{_inline(cell)}</td>" for cell in row) + "</tr>"
            for row in body
        )
        return f"<table><thead><tr>{th}</tr></thead><tbody>{trs}</tbody></table>"
    if block.kind == "quote":
        return f"<blockquote>{_inline(block.text)}</blockquote>"
    if block.kind == "rule":
        return "<hr>"
    return ""


_CSS = Template(
    """
:root { --accent: $accent; --ink: $ink; --muted: $muted; --rule: $rule; }
@page {
  size: A4; margin: 22mm 20mm 20mm 20mm;
  @top-right { content: "$title"; font: 8pt $heading_font; color: $muted; }
  @bottom-center { content: counter(page) " / " counter(pages); font: 8pt $heading_font; color: $muted; }
}
@page cover {
  margin: 0;
  @top-right { content: none; }
  @bottom-center { content: none; }
}
html { font-family: $body_font; font-size: $base_size; color: $ink; line-height: 1.55; }
h1, h2, h3 { font-family: $heading_font; color: $ink; line-height: 1.25; }
h2 { font-size: 1.45rem; margin: 1.6em 0 0.5em; padding-bottom: 0.15em; border-bottom: 1px solid $rule; }
h3 { font-size: 1.1rem; margin: 1.2em 0 0.35em; }
p { margin: 0 0 0.7em; }
a { color: $accent; }
ul, ol { margin: 0 0 0.85em 1.1em; padding-left: 1em; }
li { margin: 0.15em 0; }
code { font-family: $mono_font; font-size: 0.9em; background: #f2f2ef; padding: 0.05em 0.25em; border-radius: 3px; }
pre { background: #f6f6f3; border: 1px solid $rule; border-left: 3px solid $accent; border-radius: 4px;
      padding: 0.6em 0.8em; white-space: pre-wrap; overflow-wrap: anywhere; }
pre code { background: none; padding: 0; font-size: 0.82em; }
table { border-collapse: collapse; width: 100%; margin: 0 0 1em; font-size: 0.92em; }
th, td { border: 1px solid $rule; padding: 0.4em 0.6em; text-align: left; vertical-align: top; }
thead th { background: #eef1f5; font-family: $heading_font; }
tbody tr:nth-child(even) { background: #faf9f7; }
blockquote { margin: 0 0 1em; padding: 0.5em 0.9em; border-left: 3px solid $accent;
             background: #f7f6f3; color: $muted; }
hr { border: none; border-top: 1px solid $rule; margin: 1.4em 0; }
.cover { page: cover; height: 296mm; padding: 58mm 22mm 25mm; box-sizing: border-box; page-break-after: always; }
.cover .eyebrow { font: 9pt $heading_font; letter-spacing: 0.18em; text-transform: uppercase; color: $accent; }
.cover h1 { font-size: 2.6rem; margin: 0.35em 0 0.2em; }
.cover .subtitle { font-size: 1.15rem; color: $muted; margin: 0 0 1.2em; }
.cover .rule { width: 3.5rem; height: 4px; background: $accent; border-radius: 2px; margin: 1.3em 0; }
.cover .meta { font: 9.5pt $heading_font; color: $muted; }
.toc { page-break-after: always; }
.toc-title { font-size: 1.6rem; border: none; margin-bottom: 0.6em; }
.toc ul { list-style: none; margin: 0; padding: 0; }
.toc li { margin: 0.35em 0; border-bottom: 1px dotted $rule; }
.toc a { color: $ink; text-decoration: none; }
.toc a::after { content: target-counter(attr(href), page); float: right; color: $muted; }
.toc .lvl-3 { margin-left: 1.2em; font-size: 0.92em; }
"""
)

_NUMBERING = Template(
    """
.body { counter-reset: h2; }
.body h2 { counter-increment: h2; counter-reset: h3; }
.body h2::before { content: counter(h2) ". "; color: $accent; }
.body h3 { counter-increment: h3; }
.body h3::before { content: counter(h2) "." counter(h3) " "; color: $accent; }
"""
)


def render_html(document: DocumentContent, style: Style) -> str:
    """Build the full HTML document (with inline CSS) for the PDF engine."""
    body_parts: list[str] = []
    toc_entries: list[tuple[int, str, str]] = []
    section = 0
    for block in document.blocks:
        if block.kind == "heading":
            section += 1
            body_parts.append(_block_html(block, section))
            toc_entries.append((2 if block.level <= 2 else 3, block.text, f"sec{section}"))
        else:
            body_parts.append(_block_html(block, section))

    css = _CSS.substitute(
        accent=style.accent,
        ink=style.ink,
        muted=style.muted,
        rule=style.rule,
        title=_css_escape(document.title),
        body_font=style.body_font,
        heading_font=style.heading_font,
        mono_font=style.mono_font,
        base_size=style.base_size,
    )
    if style.number_sections:
        css += _NUMBERING.substitute(accent=style.accent)

    toc_items = "".join(
        f'<li class="lvl-{level}"><a href="#{anchor}">{_inline(text)}</a></li>'
        for level, text, anchor in toc_entries
    )
    subtitle = (
        f'<p class="subtitle">{_inline(document.subtitle)}</p>'
        if document.subtitle
        else ""
    )
    today = date.today().strftime("%B %d, %Y")
    return (
        "<!doctype html><html><head><meta charset='utf-8'>"
        f"<title>{_html.escape(document.title)}</title><style>{css}</style></head><body>"
        '<section class="cover">'
        '<div class="eyebrow">ContextGit</div>'
        f"<h1>{_inline(document.title)}</h1>"
        f"{subtitle}"
        '<div class="rule"></div>'
        f'<p class="meta">{style.label} · {today}</p>'
        "</section>"
        f'<section class="toc"><h2 class="toc-title">Contents</h2><ul>{toc_items}</ul></section>'
        f'<section class="body">{"".join(body_parts)}</section>'
        "</body></html>"
    )


def _css_escape(text: str) -> str:
    return text.replace("\\", "").replace('"', "'").replace("\n", " ")
