"""Council: the same prompt fanned out to several providers, streamed in parallel."""

import json
from pathlib import Path

from fastapi.testclient import TestClient

from contextgit.api.app import create_app
from contextgit.core.repo import Repo
from contextgit.llm import FakeProvider


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


def test_council_streams_every_member(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    client = client_for(repo)
    response = client.post(
        "/api/v1/council/stream",
        json={
            "prompt": "Should we use Redis?",
            "commit_id": repo.log()[0].id,
            "members": [
                {"provider": "mock", "model": "mock-1"},
                {"provider": "mock", "model": "mock-2"},
            ],
        },
    )
    assert response.status_code == 200
    events = parse(response.text)
    kinds = [name for name, _ in events]
    assert kinds.count("member") == 2
    assert kinds.count("member_done") == 2
    assert kinds[-1] == "done"

    # Each member's tokens reconstruct its own answer.
    for index in (0, 1):
        streamed = "".join(
            str(data["text"]) for name, data in events if name == "token" and data["index"] == index
        )
        answer = next(
            data["answer"]
            for name, data in events
            if name == "member_done" and data["index"] == index
        )
        assert streamed == answer and streamed


def test_council_member_failure_does_not_fail_the_others(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    client = client_for(repo)
    # A provider that builds but whose endpoint refuses the connection.
    client.post(
        "/api/v1/providers",
        json={"label": "Dead End", "base_url": "http://127.0.0.1:1/v1", "api_key": "x"},
    )
    response = client.post(
        "/api/v1/council/stream",
        json={
            "prompt": "hello",
            "commit_id": repo.log()[0].id,
            "members": [
                {"provider": "mock", "model": "mock-1"},
                {"provider": "dead-end", "model": "d"},
            ],
        },
    )
    events = parse(response.text)
    kinds = [name for name, _ in events]
    assert "member_done" in kinds  # the good member finished
    assert "error" in kinds  # the broken one reported without killing the run
    assert kinds[-1] == "done"


def test_council_unknown_provider_is_404(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    client = client_for(repo)
    response = client.post(
        "/api/v1/council/stream",
        json={
            "prompt": "hi",
            "members": [{"provider": "mock"}, {"provider": "nope"}],
        },
    )
    assert response.status_code == 404


def test_council_needs_at_least_two_members(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    client = client_for(repo)
    response = client.post(
        "/api/v1/council/stream",
        json={"prompt": "hi", "members": [{"provider": "mock"}]},
    )
    assert response.status_code == 422
