"""Professional documents: the forgiving parser and the styled renderers."""

from io import BytesIO
from pathlib import Path

from fastapi.testclient import TestClient

from contextgit.api.app import create_app
from contextgit.core.repo import Repo
from contextgit.documents import build_document, parse_markdown, render
from contextgit.documents import pdf as pdf_module
from contextgit.llm import FakeProvider

RICH = """# Token-Bucket Rate Limiting

A practical guide for backend teams.

## How it works

- Tokens refill at a fixed rate
- A request spends one token

### Choosing a size

1. Set the refill rate
2. Set the burst

## Example

```python
def allow(bucket):
    return bucket.tokens >= 1
```

## Comparison

| Library | Style |
|---|---|
| ReportLab | canvas |

> Prefer a library that handles page breaks.
"""


def kinds(markdown: str, fmt: str = "md") -> list[str]:
    return [block.kind for block in parse_markdown(markdown).blocks]


def test_parser_handles_the_model_artifacts() -> None:
    assert kinds(RICH) == [
        "heading",  # How it works
        "bullets",
        "heading",  # Choosing a size
        "ordered",
        "heading",  # Example
        "code",
        "heading",  # Comparison
        "table",
        "quote",
    ]


def test_parser_normalizes_hashes_used_as_bullets() -> None:
    blocks = parse_markdown("## Prerequisites\n\n### •Python 3.8+ •pip\n").blocks
    assert blocks[-1].kind == "bullets"
    assert len(blocks[-1].items) == 2


def test_parser_pulls_inline_code_fences_out() -> None:
    blocks = parse_markdown("Run ```bash pip install x ``` now.\n").blocks
    assert [b.kind for b in blocks] == ["paragraph", "code", "paragraph"]
    assert blocks[1].lang == "bash"


def test_subtitle_is_the_line_under_the_title() -> None:
    doc = parse_markdown(RICH)
    assert doc.title == "Token-Bucket Rate Limiting"
    assert doc.subtitle == "A practical guide for backend teams."


def test_every_format_and_template_renders() -> None:
    for fmt in ("md", "pdf", "docx", "pptx"):
        templates = ("report",) if fmt == "md" else ("report", "brief", "proposal")
        for template in templates:
            document = build_document(RICH, fmt, template)  # type: ignore[arg-type]
            data = render(document, fmt)  # type: ignore[arg-type]
            assert len(data) > 200
            if fmt == "pdf":
                assert data[:4] == b"%PDF"
            elif fmt in ("docx", "pptx"):
                assert data[:2] == b"PK"


def test_pdf_has_cover_toc_and_body_pages() -> None:
    import pytest

    pytest.importorskip("weasyprint")  # the reportlab fallback has no TOC
    pypdf = pytest.importorskip("pypdf")
    data = render(build_document(RICH, "pdf", "report"), "pdf")
    reader = pypdf.PdfReader(BytesIO(data))
    assert len(reader.pages) >= 3  # cover + contents + body
    assert "Contents" in (reader.pages[1].extract_text() or "")


def test_pdf_falls_back_to_reportlab(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(pdf_module, "_weasyprint", lambda html: None)
    data = render(build_document(RICH, "pdf", "report"), "pdf")
    assert data[:4] == b"%PDF"


def test_documents_stream_accepts_a_template(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    client = TestClient(create_app(repo=repo, provider=FakeProvider(default=RICH)))
    response = client.post(
        "/api/v1/documents/stream",
        json={"prompt": "rate limiting", "format": "docx", "template": "brief", "branch": "main"},
    )
    assert response.status_code == 200
    assert '"format": "docx"' in response.text
    assert "event: document" in response.text
