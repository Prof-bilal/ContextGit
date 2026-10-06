"""Render DocumentContent to a professional `.docx`.

Cover page, a table-of-contents field, header (title) / footer with page numbers,
Word Heading styles mapped to our headings, a shaded code style and real tables.
The TOC and page numbers are Word fields: Word offers to update them on open;
LibreOffice fills them automatically.
"""

from datetime import date
from io import BytesIO

from contextgit.documents.errors import INSTALL_HINT, MissingRenderer
from contextgit.documents.models import Block, DocumentContent
from contextgit.documents.styles import Style


def render_docx(document: DocumentContent, style: Style) -> bytes:
    try:
        import docx
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        from docx.shared import Pt, RGBColor
    except ImportError as exc:  # pragma: no cover - guarded by available()
        raise MissingRenderer(INSTALL_HINT) from exc

    accent = RGBColor.from_string(style.accent.lstrip("#").upper())
    muted = RGBColor.from_string(style.muted.lstrip("#").upper())
    ink = RGBColor.from_string(style.ink.lstrip("#").upper())
    body_font = style.body_font.split(",")[0].strip("'\" ")
    head_font = style.heading_font.split(",")[0].strip("'\" ")

    doc = docx.Document()
    normal = doc.styles["Normal"]
    normal.font.name = body_font
    normal.font.size = Pt(11)
    normal.font.color.rgb = ink
    for level in (1, 2, 3):
        heading = doc.styles[f"Heading {level}"]
        heading.font.name = head_font
        heading.font.color.rgb = accent

    # ---- cover ----
    doc.add_paragraph()
    eyebrow = doc.add_paragraph()
    eyebrow.alignment = WD_ALIGN_PARAGRAPH.LEFT
    run = eyebrow.add_run("CONTEXTGIT")
    run.font.size = Pt(10)
    run.font.name = head_font
    run.font.color.rgb = accent
    run.bold = True

    title = doc.add_paragraph()
    title_run = title.add_run(document.title)
    title_run.font.size = Pt(30)
    title_run.font.name = head_font
    title_run.font.color.rgb = ink
    title_run.bold = True
    if document.subtitle:
        sub = doc.add_paragraph()
        sub_run = sub.add_run(document.subtitle)
        sub_run.font.size = Pt(14)
        sub_run.font.name = head_font
        sub_run.font.color.rgb = muted
    meta = doc.add_paragraph()
    meta_run = meta.add_run(f"{style.label} · {date.today().strftime('%B %d, %Y')}")
    meta_run.font.size = Pt(10)
    meta_run.font.color.rgb = muted
    doc.add_page_break()

    # ---- table of contents (field; Word updates it on open) ----
    doc.add_heading("Contents", level=1)
    toc_para = doc.add_paragraph()
    _add_field(toc_para, r'TOC \o "1-3" \h \z \u')

    # ---- header / footer ----
    section = doc.sections[0]
    header = section.header.paragraphs[0]
    header.text = document.title
    header.style = doc.styles["Header"]
    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    footer.add_run("Page ")
    _add_field(footer, "PAGE")
    footer.add_run(" of ")
    _add_field(footer, "NUMPAGES")

    # ---- body ----
    for block in document.blocks:
        _add_block(doc, block, style)

    buffer = BytesIO()
    doc.save(buffer)
    return buffer.getvalue()


def _add_field(paragraph: object, instruction: str) -> None:
    """Insert a Word field (PAGE / NUMPAGES / TOC) into a paragraph."""
    import docx  # noqa: F401 - ensure the package is present
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = instruction
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")

    run = paragraph.add_run()  # type: ignore[attr-defined]
    run._r.append(begin)
    run._r.append(instr)
    run._r.append(separate)
    result = paragraph.add_run("1")  # type: ignore[attr-defined]
    tail = paragraph.add_run()  # type: ignore[attr-defined]
    tail._r.append(end)
    _ = result


def _shade(paragraph: object, fill: str) -> None:
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    p_pr = paragraph._p.get_or_add_pPr()  # type: ignore[attr-defined]
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    p_pr.append(shd)


def _add_block(doc: object, block: Block, style: Style) -> None:
    from docx.shared import Pt, RGBColor

    mono = style.mono_font.split(",")[0].strip("'\" ")
    if block.kind == "heading":
        doc.add_heading(block.text, level=min(block.level, 3))  # type: ignore[attr-defined]
    elif block.kind == "paragraph":
        _write_rich(doc.add_paragraph(), block.text)  # type: ignore[attr-defined]
    elif block.kind in ("bullets", "ordered"):
        word_style = "List Number" if block.kind == "ordered" else "List Bullet"
        for item in block.items:
            _write_rich(doc.add_paragraph(style=word_style), item)  # type: ignore[attr-defined]
    elif block.kind == "code":
        for line in block.lines or [" "]:
            para = doc.add_paragraph()  # type: ignore[attr-defined]
            para.paragraph_format.space_after = Pt(0)
            run = para.add_run(line)
            run.font.name = mono
            run.font.size = Pt(9)
            _shade(para, "F4F4F1")
    elif block.kind == "table" and block.rows:
        table = doc.add_table(rows=0, cols=len(block.rows[0]))  # type: ignore[attr-defined]
        table.style = "Table Grid"
        for index, row in enumerate(block.rows):
            cells = table.add_row().cells
            for cell, value in zip(cells, row, strict=False):
                cell.text = value
                if index == 0:
                    for para in cell.paragraphs:
                        for run in para.runs:
                            run.bold = True
    elif block.kind == "quote":
        para = doc.add_paragraph()  # type: ignore[attr-defined]
        run = para.add_run(block.text)
        run.italic = True
        run.font.color.rgb = RGBColor.from_string(style.muted.lstrip("#").upper())
    elif block.kind == "rule":
        para = doc.add_paragraph()  # type: ignore[attr-defined]
        run = para.add_run("─" * 40)
        run.font.color.rgb = RGBColor.from_string(style.rule.lstrip("#").upper())


def _write_rich(paragraph: object, text: str) -> None:
    """`**bold**` becomes a real bold Word run."""
    for index, part in enumerate(text.split("**")):
        if not part:
            continue
        run = paragraph.add_run(part)  # type: ignore[attr-defined]
        if index % 2 == 1:
            run.bold = True
