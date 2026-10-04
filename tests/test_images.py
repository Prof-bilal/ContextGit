"""Image mode: prompt → tiles, streamed, with the prompt committed as an artifact."""

import json
from pathlib import Path

from fastapi.testclient import TestClient

from contextgit.api.app import create_app
from contextgit.core.repo import Repo
from contextgit.llm import FakeProvider
from contextgit.llm.images import MockImages, size_for


def parse(response_text: str) -> list[tuple[str, dict[str, object]]]:
    events: list[tuple[str, dict[str, object]]] = []
    for block in response_text.strip().split("\n\n"):
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


def client_for(repo: Repo) -> TestClient:
    return TestClient(create_app(repo=repo, provider=FakeProvider()))


def test_size_mapping_by_aspect_and_backend() -> None:
    assert size_for("16:9", "gpt-image-1") == "1536x1024"
    assert size_for("9:16", "dall-e-3") == "1024x1792"
    assert size_for("1:1", "sd-model") == "512x512"


def test_mock_images_are_deterministic_svg() -> None:
    first = MockImages().generate("a token bucket", model="mock-image-1", count=1)
    second = MockImages().generate("a token bucket", model="mock-image-1", count=1)
    assert first[0].data_url == second[0].data_url
    assert first[0].data_url is not None
    assert b"<svg" in MockImages.decode(first[0].data_url)


def test_images_stream_renders_and_commits(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    client = client_for(repo)
    response = client.post(
        "/api/v1/images/stream",
        json={"prompt": "isometric token bucket", "aspect": "1:1", "count": 2},
    )
    assert response.status_code == 200
    events = parse(response.text)
    kinds = [name for name, _ in events]
    assert kinds[0] == "step"
    assert kinds.count("image") == 2
    assert kinds[-1] == "done"

    first = next(data for name, data in events if name == "image")
    assert str(first["data_url"]).startswith("data:image/svg+xml;base64,")

    commit = repo.log()[0]
    assert commit.kind == "note"
    assert commit.messages[0].content == "isometric token bucket"


def test_images_stream_reports_backend_failure(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    client = client_for(repo)
    # Point the local SD provider at a refused port.
    client.post(
        "/api/v1/providers",
        json={"id": "local-sd", "base_url": "http://127.0.0.1:1"},
    )
    response = client.post(
        "/api/v1/images/stream",
        json={"prompt": "x", "provider": "local-sd", "count": 1},
    )
    assert response.status_code == 200
    events = parse(response.text)
    kinds = [name for name, _ in events]
    assert "error" in kinds
    assert "done" not in kinds
