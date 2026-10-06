"""Render a DocumentContent to file bytes: Markdown, PDF, Word, PowerPoint.

Markdown needs nothing; the other formats each need one optional library, and a
missing one raises `MissingRenderer` with an actionable message. Each renderer
receives the chosen house style so a template looks the same in every format.
"""

import importlib.util

from contextgit.documents.errors import MissingRenderer
from contextgit.documents.models import DocumentContent, DocumentFormat
from contextgit.documents.styles import style_for

_IMPORTS: dict[str, str] = {"docx": "docx", "pptx": "pptx", "pdf": "reportlab"}


def available(fmt: DocumentFormat) -> bool:
    """Whether a format can be rendered in this environment."""
    if fmt == "md":
        return True
    module = _IMPORTS.get(fmt)
    return module is not None and importlib.util.find_spec(module) is not None


def render(document: DocumentContent, fmt: DocumentFormat) -> bytes:
    """Render a document to bytes in the requested format."""
    if fmt == "md":
        return document.markdown.encode("utf-8")

    style = style_for(document.template)
    if fmt == "pdf":
        from contextgit.documents.pdf import render_pdf

        return render_pdf(document, style)
    if fmt == "docx":
        from contextgit.documents.docx_writer import render_docx

        return render_docx(document, style)
    if fmt == "pptx":
        from contextgit.documents.pptx_writer import render_pptx

        return render_pptx(document, style)
    raise MissingRenderer(f"Unknown document format: {fmt!r}")
