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


def test_spatial_team_routes_are_scoped_and_persist_independent_teams(tmp_path: Path) -> None:
    client, project = _client(tmp_path)
    first = client.post("/api/v1/teams", json={"name": "first", "project_path": str(project)})
    second = client.post("/api/v1/teams", json={"name": "second", "project_path": str(project)})
    assert first.status_code == second.status_code == 201
    first_id, second_id = first.json()["team"]["id"], second.json()["team"]["id"]

    task = client.post(f"/api/v1/teams/{first_id}/tasks", json={"title": "owned"})
    assert task.status_code == 201
    assert [item["title"] for item in client.get(f"/api/v1/teams/{first_id}/tasks").json()] == ["owned"]
    assert client.get(f"/api/v1/teams/{second_id}/tasks").json() == []
    assert client.get(f"/api/v1/teams/{first_id}").status_code == 200
    assert len(client.get("/api/v1/teams").json()) == 2
    assert first.json()["layout"]["x"] != second.json()["layout"]["x"]
    other_root = tmp_path / "other"
    other_root.mkdir()
    other_project = _project(other_root)
    other_team = client.post("/api/v1/teams", json={"name": "other", "project_path": str(other_project)})
    assert other_team.status_code == 201
    assert [team["team"]["id"] for team in client.get(
        "/api/v1/teams", params={"project_path": str(project)}
    ).json()] == [first_id, second_id]

    viewport = client.put("/api/v1/canvas/viewport", json={
        "project_path": str(project), "x": -235.5, "y": 82, "zoom": 0.74,
    })
    assert viewport.status_code == 200
    assert client.get("/api/v1/canvas/viewport", params={"project_path": str(project)}).json() == viewport.json()

    layout = client.patch(f"/api/v1/teams/{first_id}/layout", json={"x": 214, "collapsed": True})
    assert layout.status_code == 200
    assert layout.json()["x"] == 214 and layout.json()["collapsed"] is True
    assert layout.json()["width"] == first.json()["layout"]["width"]

    cross_team = client.post(f"/api/v1/teams/{second_id}/tasks/{task.json()['id']}/start")
    assert cross_team.status_code == 404
    message = client.post(f"/api/v1/teams/{first_id}/messages", json={"body": "hello"})
    assert message.status_code == 201
    assert client.get(f"/api/v1/teams/{second_id}/messages").json() == []

    plan = client.put(f"/api/v1/teams/{second_id}/plan", json={
        "goal": "deliver",
        "tasks": [{"id": "worker", "title": "worker", "scope": ["src/**"], "agent": "shell"}],
        "completion_criteria": ["tests pass"],
        "quality_gates": ["python -m pytest"],
    })
    assert plan.status_code == 200
    approved = client.post(f"/api/v1/teams/{second_id}/plan/approve")
    assert approved.status_code == 200
    assert [entry["title"] for entry in approved.json()["tasks"]] == ["worker"]
    assert client.post(f"/api/v1/teams/{second_id}/plan/approve").status_code == 200
    assert len(client.get(f"/api/v1/teams/{second_id}/tasks").json()) == 1
    merge_preview = client.post(f"/api/v1/teams/{second_id}/merge/preview")
    assert merge_preview.status_code == 200
    assert merge_preview.json()["ready"] is False
    assert merge_preview.json()["requires_confirmation"] is True


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


def test_standalone_task_does_not_require_a_team(tmp_path: Path) -> None:
    client, _ = _client(tmp_path)
    assert client.get("/api/v1/tasks").json() == []

    response = client.post(
        "/api/v1/tasks", json={"title": "orphan", "agent": "codex", "parent_id": None}
    )

    assert response.status_code == 201
    task = response.json()
    assert task["phase"] == "READY"
    assert task["capabilities"]["launch"] is True
    assert task["unsupported"] == ["transcript", "usage"]
    assert task["branch"] is None
    assert [item["id"] for item in client.get("/api/v1/tasks").json()] == [task["id"]]
    assert client.get(f"/api/v1/tasks/{task['id']}").json()["id"] == task["id"]


def test_task_start_stop_retry_over_http(tmp_path: Path) -> None:
    client, project = _client(tmp_path)
    client.post("/api/v1/team", json={"name": "portal", "project_path": str(project)})
    task = client.post("/api/v1/tasks", json={"title": "run", "agent": "terminal"}).json()

    started = client.post(
        f"/api/v1/team/tasks/{task['id']}/start", json={"agent": "terminal"}
    )

    assert started.status_code == 200, started.text
    running = started.json()
    assert running["phase"] == "RUNNING"
    assert running["branch"] and running["worktree_path"] and running["agent_run_id"]
    assert client.get(f"/api/v1/team/tasks/{task['id']}/events").json()[0]["event_type"] == (
        "lifecycle"
    )

    stopped = client.post(
        f"/api/v1/team/tasks/{task['id']}/stop", json={"note": "user cancelled"}
    ).json()
    assert stopped["phase"] == "FAILED"
    assert stopped["status"] == "failed"

    retried = client.post(
        f"/api/v1/team/tasks/{task['id']}/retry", json={"agent": "terminal"}
    ).json()
    assert retried["phase"] == "RUNNING"
    assert retried["session_id"] != running["session_id"]


def test_update_task_rejects_an_invalid_phase_move(tmp_path: Path) -> None:
    client, _ = _client(tmp_path)
    task = client.post("/api/v1/tasks", json={"title": "not implemented"}).json()

    response = client.patch(f"/api/v1/team/tasks/{task['id']}", json={"status": "review"})

    assert response.status_code == 409
    assert response.json()["type"] == "InvalidTaskTransition"
