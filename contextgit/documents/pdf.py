"""PDF engine: WeasyPrint (HTML/CSS) with a reportlab fallback.

WeasyPrint gives the professional layout (cover, TOC with page numbers, running
header/footer). It needs Pango/cairo system libraries, so when it can't run we
fall back to a reportlab template — plainer, but a valid PDF every time.
"""

from io import BytesIO
from typing import Any
from xml.sax.saxutils import escape

from contextgit.documents.html import render_html
from contextgit.documents.models import Block, DocumentContent
from contextgit.documents.styles import Style


def render_pdf(document: DocumentContent, style: Style) -> bytes:
    """Render to PDF bytes: WeasyPrint first, reportlab when unavailable."""
    rendered = _weasyprint(render_html(document, style))
    if rendered is not None:
        return rendered
    return _reportlab(document, style)


def _weasyprint(html: str) -> bytes | None:
    try:
        from weasyprint import HTML
    except Exception:  # noqa: BLE001 - missing lib or system deps
        return None
    try:
        return bytes(HTML(string=html).write_pdf())
    except Exception:  # noqa: BLE001 - fall back rather than fail the request
        return None


def _reportlab(document: DocumentContent, style: Style) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_JUSTIFY
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        BaseDocTemplate,
        Frame,
        HRFlowable,
        NextPageTemplate,
        PageBreak,
        PageTemplate,
        Paragraph,
        Spacer,
    )

    accent = colors.HexColor(style.accent)
    ink = colors.HexColor(style.ink)
    muted = colors.HexColor(style.muted)
    rule = colors.HexColor(style.rule)
    base = getSampleStyleSheet()

    def style_of(name: str, **kw: object) -> ParagraphStyle:
        return ParagraphStyle(name=name, parent=base["BodyText"], **kw)

    body = style_of("Body", fontName="Times-Roman", fontSize=10.5, leading=15, textColor=ink,
                    alignment=TA_JUSTIFY, spaceAfter=6)
    h2 = style_of("H2", fontName="Helvetica-Bold", fontSize=15, leading=19, textColor=ink,
                  spaceBefore=14, spaceAfter=6)
    h3 = style_of("H3", fontName="Helvetica-Bold", fontSize=12, leading=15, textColor=ink,
                  spaceBefore=10, spaceAfter=4)
    quote = style_of("Quote", fontName="Times-Italic", fontSize=10.5, leading=15, textColor=muted,
                     leftIndent=10, spaceAfter=8)
    code_style = style_of("Code", fontName="Courier", fontSize=9, leading=12, textColor=ink)
    title_style = style_of("CoverTitle", fontName="Helvetica-Bold", fontSize=30, leading=34,
                           textColor=ink, spaceBefore=0, spaceAfter=8)
    sub_style = style_of("CoverSub", fontName="Helvetica", fontSize=14, leading=18,
                         textColor=muted, spaceAfter=16)

    def rl(text: str) -> str:
        out = escape(text)
        out = out.replace("**", "\x00")
        while out.count("\x00") >= 2:
            out = out.replace("\x00", "<b>", 1).replace("\x00", "</b>", 1)
        out = out.replace("\x00", "")
        return out

    buffer = BytesIO()
    doc = BaseDocTemplate(
        buffer, pagesize=A4, title=document.title,
        leftMargin=20 * mm, rightMargin=20 * mm, topMargin=20 * mm, bottomMargin=18 * mm,
    )

    def on_cover(canvas: Any, _doc: Any) -> None:  # pragma: no cover - drawing only
        pass

    def on_body(canvas: Any, _doc: Any) -> None:
        canvas.saveState()
        canvas.setStrokeColor(rule)
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(muted)
        canvas.drawString(20 * mm, 12 * mm, document.title[:70])
        canvas.drawRightString(190 * mm, 12 * mm, f"Page {canvas.getPageNumber()}")
        canvas.setStrokeColor(accent)
        canvas.setLineWidth(2)
        canvas.line(20 * mm, 15 * mm, 190 * mm, 15 * mm)
        canvas.restoreState()

    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="body")
    cover_frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="cover")
    doc.addPageTemplates([
        PageTemplate(id="cover", frames=[cover_frame], onPage=on_cover),
        PageTemplate(id="body", frames=[frame], onPage=on_body),
    ])

    story: list[object] = [Spacer(1, 60 * mm), Paragraph(rl(document.title), title_style)]
    if document.subtitle:
        story.append(Paragraph(rl(document.subtitle), sub_style))
    story.append(HRFlowable(width="25%", thickness=3, color=accent, spaceBefore=4, spaceAfter=8))
    story.append(Paragraph(
        f'<font color="{style.accent}"><b>{style.label}</b></font>', body))
    story.append(NextPageTemplate("body"))
    story.append(PageBreak())

    for block in document.blocks:
        story.extend(_rl_block(block, body, h2, h3, quote, code_style))
    doc.build(story)
    return buffer.getvalue()


def _rl_block(
    block: Block,
    body: object,
    h2: object,
    h3: object,
    quote: object,
    code_style: object,
) -> list[object]:
    from reportlab.lib import colors
    from reportlab.platypus import (
        HRFlowable,
        ListFlowable,
        ListItem,
        Paragraph,
        Preformatted,
        Spacer,
        Table,
        TableStyle,
    )

    def rl(text: str) -> str:
        out = escape(text)
        parts = out.split("**")
        return "".join(part if i % 2 == 0 else f"<b>{part}</b>" for i, part in enumerate(parts))

    if block.kind == "heading":
        return [Paragraph(rl(block.text), h3 if block.level >= 3 else h2)]
    if block.kind == "paragraph":
        return [Paragraph(rl(block.text), body)]
    if block.kind in ("bullets", "ordered"):
        items = [ListItem(Paragraph(rl(i), body)) for i in block.items]
        return [ListFlowable(items, bulletType="1" if block.kind == "ordered" else "bullet"),
                Spacer(1, 6)]
    if block.kind == "code":
        pre = Preformatted("\n".join(block.lines), code_style)
        table = Table([[pre]], colWidths=["100%"])
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f4f4f1")),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#d8d6cf")),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        return [table, Spacer(1, 8)]
    if block.kind == "table" and block.rows:
        header, *rows = block.rows
        data = [[Paragraph(f"<b>{rl(c)}</b>", body) for c in header]]
        data += [[Paragraph(rl(c), body) for c in row] for row in rows]
        table = Table(data, hAlign="LEFT")
        table.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d8d6cf")),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eef1f5")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        return [table, Spacer(1, 8)]
    if block.kind == "quote":
        return [Paragraph(rl(block.text), quote)]
    if block.kind == "rule":
        return [HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#d7d2c8"),
                           spaceBefore=4, spaceAfter=8)]
    return []
