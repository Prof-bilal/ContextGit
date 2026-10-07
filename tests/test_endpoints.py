"""The endpoint graph: discovery across frameworks, merging, and provenance."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from contextgit.core.models import Endpoint, EndpointSource, Message
from contextgit.core.repo import Repo
from contextgit.endpoints import discover, endpoint_provenance, graph_with_provenance
from contextgit.endpoints import provenance as provenance_module

FIXTURES = Path(__file__).parent / "fixtures"


def find(found: list[Endpoint], method: str, path: str) -> Endpoint | None:
    return next(
        (item for item in found if item.method == method and item.path == path),
        None,
    )


# ------------------------------------------------------------- discovery --


def test_python_routes_are_parsed_with_prefix_fields_and_auth() -> None:
    graph = discover(FIXTURES / "fastapi_app")
    ids = {(item.method, item.path) for item in graph.endpoints}
    assert ("GET", "/health") in ids
    # The router prefix is joined onto the operation path.
    assert ("POST", "/items/{item_id}/notes") in ids

    note = find(graph.endpoints, "POST", "/items/{item_id}/notes")
    assert note is not None
    assert note.source.kind == "python"
    assert note.source.confidence == "high"
    assert note.source.file == "app.py"
    assert note.source.line is not None
    assert note.response_status == 201
    assert note.auth is True

    locations = {field.name: field.location for field in note.request_fields}
    assert locations["item_id"] == "path"
    assert locations["body"] == "body"


def test_express_and_nest_style_routes_are_found() -> None:
    graph = discover(FIXTURES / "express_app")
    ids = {(item.method, item.path) for item in graph.endpoints}
    assert ("GET", "/health") in ids
    assert ("POST", "/widgets/{id}") in ids
    assert ("DELETE", "/widgets/{id}") in ids
    # `res.status(204)` must not be mistaken for a route.
    assert all(item.method != "STATUS" for item in graph.endpoints)

    widget = find(graph.endpoints, "POST", "/widgets/{id}")
    assert widget is not None
    assert widget.source.kind == "javascript"
    assert widget.source.file == "server.ts"


def test_go_routes_include_method_prefixed_handlers() -> None:
    graph = discover(FIXTURES / "go_app")
    ids = {(item.method, item.path) for item in graph.endpoints}
    assert ("GET", "/health") in ids
    assert ("POST", "/widgets") in ids
    assert ("GET", "/legacy") in ids


def test_django_url_convs_are_normalised() -> None:
    graph = discover(FIXTURES / "django_app")
    ids = {(item.method, item.path) for item in graph.endpoints}
    assert ("GET", "/health/") in ids
    assert ("GET", "/items/{pk}/") in ids


def test_openapi_wins_and_keeps_the_code_location(tmp_path: Path) -> None:
    (tmp_path / "app.py").write_text(
        'from fastapi import FastAPI\n\napp = FastAPI()\n\n\n@app.get("/things")\ndef list_things() -> list[str]:\n    return []\n'
    )
    spec: dict[str, object] = {
        "paths": {
            "/things": {
                "get": {
                    "summary": "List things",
                    "tags": ["things"],
                    "parameters": [
                        {"name": "limit", "in": "query", "schema": {"type": "integer"}}
                    ],
                    "responses": {"200": {"description": "ok"}},
                }
            }
        }
    }
    graph = discover(tmp_path, openapi=spec)
    assert len(graph.endpoints) == 1
    endpoint = graph.endpoints[0]
    assert endpoint.source.kind == "openapi"
    assert endpoint.source.confidence == "high"
    assert endpoint.operation == "List things"
    assert endpoint.tags == ["things"]
    assert endpoint.response_status == 200
    assert [field.name for field in endpoint.request_fields] == ["limit"]
    # The spec has no file, so the scan's location is kept.
    assert endpoint.source.file == "app.py"


def test_files_outside_the_project_are_not_scanned(tmp_path: Path) -> None:
    (tmp_path / "node_modules").mkdir()
    (tmp_path / "node_modules" / "dep.js").write_text("app.get('/dep', handler)\n")
    (tmp_path / "index.js").write_text("app.get('/real', handler)\n")
    graph = discover(tmp_path)
    assert [item.path for item in graph.endpoints] == ["/real"]


# ------------------------------------------------------------ provenance --


def _git(project: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=project, check=True, capture_output=True)


@pytest.fixture
def git_project(tmp_path: Path) -> Path:
    project = tmp_path / "project"
    project.mkdir()
    (project / "app.py").write_text(
        'from fastapi import FastAPI\n\napp = FastAPI()\n\n\n@app.get("/health")\ndef health() -> dict[str, str]:\n    return {"status": "ok"}\n'
    )
    _git(project, "init", "-q", "-b", "main")
    _git(project, "config", "user.email", "t@example.com")
    _git(project, "config", "user.name", "t")
    _git(project, "add", "-A")
    _git(project, "commit", "-q", "-m", "add health endpoint")
    return project


def test_untracked_change_reports_only_the_commit(git_project: Path, tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    graph = graph_with_provenance(repo, git_project)
    health = find(graph.endpoints, "GET", "/health")
    assert health is not None and health.provenance is not None
    assert health.provenance.tracked is False
    assert health.provenance.code_commit is not None
    assert health.provenance.code_commit_summary == "add health endpoint"
    assert health.provenance.run_id is None


def test_change_is_linked_to_the_run_whose_branch_contains_it(
    git_project: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = Repo.init(tmp_path / "repo")
    session = repo.create_session(
        "checkout flow", branch="checkout", project_path=str(git_project), worktree=True
    )
    assert session.git_branch == "ctx/checkout"
    repo.commit(
        [Message(role="user", content="switch auth to JWT")],
        model="test",
        branch=session.branch,
        summary="switch auth to JWT",
    )

    monkeypatch.setattr(provenance_module, "_blame_commit", lambda *_: "a" * 40)
    monkeypatch.setattr(provenance_module, "_commit_info", lambda *_: {"id": "a" * 40})
    monkeypatch.setattr(
        provenance_module,
        "_branches_containing",
        lambda *_: {"main", f"ctx/{session.branch}"},
    )

    endpoint = Endpoint(
        id="get /health",
        method="GET",
        path="/health",
        source=EndpointSource(kind="python", file="app.py", line=6),
    )
    provenance = endpoint_provenance(repo, git_project, endpoint)

    assert provenance.tracked is True
    assert provenance.run_id == session.id
    assert provenance.run_name == "checkout flow"
    assert provenance.context_branch == session.branch
    assert provenance.context_commit is not None
    assert provenance.summary == "switch auth to JWT"


def test_endpoints_without_a_code_location_have_no_provenance(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    endpoint = Endpoint(id="get /x", method="GET", path="/x", source=EndpointSource(kind="manual"))
    provenance = endpoint_provenance(repo, tmp_path, endpoint)
    assert provenance.tracked is False
    assert provenance.code_commit is None


def test_graph_route_serves_the_endpoint_graph(git_project: Path) -> None:
    from fastapi.testclient import TestClient

    from contextgit.api.app import create_app
    from contextgit.llm.fake import FakeProvider

    repo = Repo.init(git_project.parent / "repo")
    client = TestClient(create_app(repo=repo, provider=FakeProvider()))
    response = client.get("/api/v1/endpoints", params={"project_path": str(git_project)})
    assert response.status_code == 200
    body = response.json()
    assert body["project_path"] == str(git_project)
    assert [item["id"] for item in body["endpoints"]] == ["get /health"]
    assert body["endpoints"][0]["provenance"]["code_commit_summary"] == "add health endpoint"
