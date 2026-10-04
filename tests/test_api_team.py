"""Team mode over HTTP: create, gate on dependencies, enforce claims, complete."""

from __future__ import annotations

import subprocess
from pathlib import Path

from fastapi.testclient import TestClient

from contextgit.api.app import create_app
from contextgit.core.repo import Repo
from contextgit.llm.fake import FakeProvider


def _git(cwd: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, check=True
    ).stdout


def _project(tmp_path: Path) -> Path:
    root = tmp_path / "proj"
    root.mkdir()
    _git(root, "init", "-q", "-b", "main")
    _git(root, "config", "user.email", "t@example.com")
    _git(root, "config", "user.name", "Tester")
    (root / "app.py").write_text("print('hi')\n")
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "init")
    return root


def _client(tmp_path: Path) -> tuple[TestClient, Path]:
    project = _project(tmp_path)
    repo = Repo.init(tmp_path / "repo")
    return TestClient(create_app(repo=repo, provider=FakeProvider())), project


def test_team_flow_over_http(tmp_path: Path) -> None:
    client, project = _client(tmp_path)

    assert client.get("/api/v1/team").json() is None

    created = client.post(
        "/api/v1/team", json={"name": "portal", "project_path": str(project)}
    )
    assert created.status_code == 201
    assert created.json()["team"]["base_ref"] == "main"

    api = client.post(
        "/api/v1/team/tasks",
        json={"title": "api", "agent": "shell", "scope": ["src/api/**"], "role": "backend"},
    ).json()
    web = client.post(
        "/api/v1/team/tasks",
        json={"title": "web", "agent": "shell", "depends_on": [api["id"]]},
    ).json()
    assert web["blocked_by"] == [api["id"]]

    # A blocked task cannot be started by hand.
    refused = client.post(f"/api/v1/team/tasks/{web['id']}/start")
    assert refused.status_code == 409

    launched = client.post("/api/v1/team/launch")
    assert launched.status_code == 200
    assert [task["title"] for task in launched.json()] == ["api"]

    board = client.get("/api/v1/team").json()
    assert {task["title"]: task["status"] for task in board["tasks"]} == {
        "api": "working",
        "web": "blocked",
    }

    # Completing now lands in review; approval finishes it and starts what it unblocked.
    assert client.post(f"/api/v1/team/tasks/{api['id']}/complete").status_code == 200
    board = client.get("/api/v1/team").json()
    assert {task["title"]: task["status"] for task in board["tasks"]} == {
        "api": "review",
        "web": "blocked",
    }

    assert client.post(f"/api/v1/team/tasks/{api['id']}/approve").status_code == 200
    board = client.get("/api/v1/team").json()
    assert {task["title"]: task["status"] for task in board["tasks"]} == {
        "api": "done",
        "web": "working",
    }

    # The board file exists and names both tasks.
    text = (project / ".contextgit" / "team.md").read_text()
    assert "api" in text and "web" in text

    # Messages came along.
    assert client.get("/api/v1/team/messages").status_code == 200


def test_overlapping_scopes_are_rejected_with_409(tmp_path: Path) -> None:
    client, project = _client(tmp_path)
    client.post("/api/v1/team", json={"name": "portal", "project_path": str(project)})
    client.post("/api/v1/team/tasks", json={"title": "a", "scope": ["src/api/**"]})
    client.post("/api/v1/team/tasks", json={"title": "b", "scope": ["src/api/users.py"]})

    response = client.post("/api/v1/team/launch")

    assert response.status_code == 409
    assert response.json()["type"] == "ScopeConflict"
    # Nothing was half-launched.
    board = client.get("/api/v1/team").json()
    assert all(task["session_id"] is None for task in board["tasks"])


def test_cycle_is_rejected_with_422(tmp_path: Path) -> None:
    client, project = _client(tmp_path)
    client.post("/api/v1/team", json={"name": "portal", "project_path": str(project)})
    first = client.post("/api/v1/team/tasks", json={"title": "a"}).json()
    second = client.post(
        "/api/v1/team/tasks", json={"title": "b", "depends_on": [first["id"]]}
    ).json()

    response = client.patch(
        f"/api/v1/team/tasks/{first['id']}", json={"depends_on": [second["id"]]}
    )

    assert response.status_code == 422
    assert response.json()["type"] == "TaskCycleError"


def test_tasks_require_a_team(tmp_path: Path) -> None:
    client, _ = _client(tmp_path)
    response = client.post("/api/v1/team/tasks", json={"title": "orphan"})
    assert response.status_code == 404
    assert response.json()["type"] == "TeamNotFound"
