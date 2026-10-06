"""Document mode: markdown parsing, rendering to every format, and the API."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from contextgit.api.app import create_app
from contextgit.core.repo import Repo
from contextgit.documents import build_document, parse_markdown, render
from contextgit.llm import FakeProvider

SAMPLE = """# Token Buckets

A token bucket refills over time.

## How it works

- Tokens refill at a fixed rate
- Each request spends a token

## Sizing

Pick a burst size and a refill rate.
"""


def parse_sse(text: str) -> list[tuple[str, dict[str, object]]]:
    events: list[tuple[str, dict[str, object]]] = []
    for block in text.strip().split("\n\n"):
        name: str | None = None
        data: dict[str, object] | None = None
        for line in block.splitlines():
            if line.startswith("event: "):
                name = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
        if name is not None and data is not None:
            events.append((name, data))
    return events


def test_parse_markdown_splits_title_and_blocks() -> None:
    content = parse_markdown(SAMPLE)
    assert content.title == "Token Buckets"
    # The line right under the title is the subtitle, not a body paragraph.
    assert content.subtitle == "A token bucket refills over time."
    kinds = [block.kind for block in content.blocks]
    assert kinds[0] == "heading"
    assert "bullets" in kinds
    # The `#` title becomes the document title, not a duplicate block.
    assert all(block.text != "Token Buckets" for block in content.blocks)


def test_render_markdown_is_the_source() -> None:
    assert b"# Token Buckets" in render(parse_markdown(SAMPLE), "md")


def test_render_pdf_has_pdf_header() -> None:
    pytest.importorskip("reportlab")
    assert render(parse_markdown(SAMPLE), "pdf")[:4] == b"%PDF"


def test_render_docx_and_pptx_are_office_zip_files() -> None:
    pytest.importorskip("docx")
    pytest.importorskip("pptx")
    content = build_document(SAMPLE, "pptx")
    assert content.slides and content.slides[0].title == "How it works"
    assert render(content, "docx")[:2] == b"PK"
    assert render(content, "pptx")[:2] == b"PK"


def test_pptx_outline_is_preferred_over_headings() -> None:
    outline = json.dumps(
        {"title": "Deck", "slides": [{"title": "A", "bullets": ["x", "y"]}]}
    )
    content = build_document(f"{SAMPLE}\n```json\n{outline}\n```\n", "pptx")
    assert content.title == "Deck"
    assert content.slides[0].title == "A"
    assert content.slides[0].bullets == ["x", "y"]


def test_documents_stream_generates_and_downloads(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    client = TestClient(create_app(repo=repo, provider=FakeProvider(default=SAMPLE)))

    response = client.post(
        "/api/v1/documents/stream",
        json={"prompt": "token buckets", "format": "md", "branch": "main"},
    )
    assert response.status_code == 200
    events = parse_sse(response.text)
    kinds = [name for name, _ in events]
    assert kinds[0] == "step"
    assert "token" in kinds
    document = next(data for name, data in events if name == "document")
    assert document["format"] == "md"
    assert kinds[-1] == "done"

    # The turn is committed to the conversation.
    assert "document:" in (repo.log("main")[0].summary or "")

    download = client.get(f"/api/v1/documents/{document['id']}", params={"format": "md"})
    assert download.status_code == 200
    assert "# Token Buckets" in download.text


def test_list_documents_endpoint(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    client = TestClient(create_app(repo=repo, provider=FakeProvider(default=SAMPLE)))
    client.post(
        "/api/v1/documents/stream",
        json={"prompt": "token buckets", "format": "md", "branch": "main"},
    )
    listing = client.get("/api/v1/documents").json()
    assert len(listing) == 1
    assert listing[0]["format"] == "md"
    assert listing[0]["title"] == "Token Buckets"
    assert listing[0]["size"] > 0


def test_download_unknown_document_is_404(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    client = TestClient(create_app(repo=repo, provider=FakeProvider()))
    assert client.get("/api/v1/documents/nope", params={"format": "pdf"}).status_code == 404
    assert client.get("/api/v1/documents/nope", params={"format": "txt"}).status_code == 422
