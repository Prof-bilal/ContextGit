"""Project-scoped session detail and durable-memory API coverage."""

import json
from pathlib import Path

from fastapi.testclient import TestClient

from contextgit.api.app import create_app
from contextgit.core.repo import Repo
from contextgit.llm.fake import FakeProvider


class FailingProvider(FakeProvider):
    def complete(self, messages, **opts):
        raise RuntimeError("HTTP 401: invalid provider key")


def memory_reply() -> str:
    return json.dumps(
        {
            "summary": "A small web project with a tested API.",
            "architecture": ["Keep the API and renderer separated."],
            "workflow": ["Run the focused tests before committing."],
            "conventions": ["Prefer explicit, readable names."],
            "decisions": ["Use the local SQLite history as the source of truth."],
            "rejected": ["Do not use an unbounded transcript as context."],
            "skills": ["backend-testing"],
            "validation": ["Run the backend test suite."],
            "open_questions": ["Which deployment target is next?"],
            "conflicts": [],
        }
    )


def test_session_detail_memory_preview_and_approval(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "contextgit")
    project = tmp_path / "project-a"
    project.mkdir()
    provider = FakeProvider(default=memory_reply())
    client = TestClient(create_app(repo=repo, provider=provider))

    created = client.post(
        "/api/v1/sessions",
        json={
            "name": "Build API",
            "project_path": str(project),
            "task": "Build a small API",
            "role": "builder",
            "skills": ["backend-testing"],
        },
    )
    assert created.status_code == 201
    session = created.json()
    staged = client.post(
        f"/api/v1/sessions/{session['id']}/staging",
        json={
            "messages": [
                {"role": "user", "content": "Build the API"},
                {"role": "assistant", "content": "I will add tests first."},
            ]
        },
    )
    assert staged.status_code == 200
    committed = client.post(f"/api/v1/sessions/{session['id']}/commit", json={})
    assert committed.status_code == 200

    detail = client.get(f"/api/v1/sessions/{session['id']}/detail")
    assert detail.status_code == 200
    payload = detail.json()
    assert [item["content"] for item in payload["messages"]][-2:] == [
        "Build the API",
        "I will add tests first.",
    ]
    assert payload["staged_messages"] == []
    assert payload["commits"]

    before = client.get("/api/v1/project-memory", params={"project_path": str(project)}).json()
    assert before["current"] is None
    preview_response = client.post(
        "/api/v1/project-memory/synthesize", json={"project_path": str(project)}
    )
    assert preview_response.status_code == 200
    preview = preview_response.json()
    assert preview["status"] == "draft"
    assert preview["source_session_ids"] == [session["id"]]
    assert client.get("/api/v1/project-memory", params={"project_path": str(project)}).json()[
        "current"
    ] is None

    approved = client.post(
        f"/api/v1/project-memory/{preview['id']}/approve", json={"memory": preview}
    )
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"
    assert approved.json()["revision"] == 1
    current = client.get("/api/v1/project-memory", params={"project_path": str(project)}).json()
    assert current["current"]["summary"] == "A small web project with a tested API."
    assert "Decisions" in current["text"]
    assert "Approved project memory" in (project / "AGENTS.md").read_text()


def test_project_memory_rejects_cross_project_sources(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "contextgit")
    project_a = tmp_path / "project-a"
    project_b = tmp_path / "project-b"
    project_a.mkdir()
    project_b.mkdir()
    client = TestClient(create_app(repo=repo, provider=FakeProvider(default=memory_reply())))
    session_a = client.post(
        "/api/v1/sessions", json={"name": "A", "project_path": str(project_a)}
    ).json()
    session_b = client.post(
        "/api/v1/sessions", json={"name": "B", "project_path": str(project_b)}
    ).json()

    response = client.post(
        "/api/v1/project-memory/synthesize",
        json={"project_path": str(project_a), "session_ids": [session_a["id"], session_b["id"]]},
    )
    assert response.status_code == 400
    assert "belong to the selected project" in response.json()["detail"]


def test_project_memory_provider_failure_is_actionable_not_internal_error(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "contextgit")
    project = tmp_path / "project"
    project.mkdir()
    client = TestClient(create_app(repo=repo, provider=FailingProvider()))

    response = client.post(
        "/api/v1/project-memory/synthesize",
        json={"project_path": str(project)},
    )

    assert response.status_code == 502
    assert response.json()["detail"] == "Project-memory provider failed: HTTP 401: invalid provider key"
