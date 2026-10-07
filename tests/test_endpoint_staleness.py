"""Phase C: which generated tests the code has moved out from under."""

from __future__ import annotations

import subprocess
from pathlib import Path

from fastapi.testclient import TestClient

from contextgit.api.app import create_app
from contextgit.core.models import (
    Endpoint,
    EndpointGraph,
    EndpointProvenance,
    EndpointSource,
    EndpointTestFile,
    EndpointTestSuite,
    utcnow,
)
from contextgit.core.repo import Repo
from contextgit.endpoints import discover, staleness
from contextgit.endpoints.tests import handler_commit
from contextgit.llm.fake import FakeProvider

OLD_COMMIT = "a" * 40
NEW_COMMIT = "b" * 40

APP = '''\
from fastapi import FastAPI

app = FastAPI()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
'''


def endpoint(*, commit: str | None = NEW_COMMIT, summary: str | None = "switch auth to JWT", run: str | None = "checkout flow") -> Endpoint:
    provenance = (
        EndpointProvenance(
            tracked=run is not None,
            code_commit=commit,
            code_commit_summary=summary,
            run_name=run,
        )
        if commit
        else None
    )
    return Endpoint(
        id="get /health",
        method="GET",
        path="/health",
        source=EndpointSource(kind="python", file="app.py", line=6),
        provenance=provenance,
    )


def suite(state: str = "untested", verified: str | None = OLD_COMMIT) -> EndpointTestSuite:
    return EndpointTestSuite(
        project_path="/tmp/project",
        files=[
            EndpointTestFile(
                endpoint_id="get /health",
                file="tests/api/test_get_health.py",
                handler="app.py:6",
                tests=["test_health_ok"],
                status="pass",
                ran_at=utcnow(),
                verified_at_commit=verified,
                state=state,  # type: ignore[arg-type]
            )
        ],
    )


def test_a_moved_handler_makes_its_tests_stale_with_the_reason(tmp_path: Path) -> None:
    graph = EndpointGraph(project_path=str(tmp_path), endpoints=[endpoint()])
    annotated = staleness.annotate(tmp_path, suite(), graph)

    entry = annotated.files[0]
    assert entry.state == "stale"
    assert annotated.stale == 1
    # The reason names the change and the run behind it, not just a hash.
    assert "bbbbbbb" in entry.reason
    assert "switch auth to JWT" in entry.reason
    assert "checkout flow" in entry.reason


def test_an_untouched_handler_stays_fresh(tmp_path: Path) -> None:
    graph = EndpointGraph(project_path=str(tmp_path), endpoints=[endpoint(commit=OLD_COMMIT)])
    annotated = staleness.annotate(tmp_path, suite(), graph)
    assert annotated.files[0].state == "fresh"
    assert annotated.files[0].reason is None
    assert annotated.stale == 0


def test_a_removed_endpoint_retires_its_tests(tmp_path: Path) -> None:
    graph = EndpointGraph(project_path=str(tmp_path), endpoints=[])
    annotated = staleness.annotate(tmp_path, suite(), graph)

    entry = annotated.files[0]
    assert entry.state == "retired"
    assert annotated.retired == 1
    assert "no longer in the project" in entry.reason


def test_a_test_that_never_passed_is_not_called_stale(tmp_path: Path) -> None:
    graph = EndpointGraph(project_path=str(tmp_path), endpoints=[endpoint()])
    annotated = staleness.annotate(tmp_path, suite(verified=None), graph)
    assert annotated.files[0].state == "untested"
    assert annotated.files[0].reason is None


def git(project: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=project, check=True, capture_output=True)


def git_project(tmp_path: Path) -> Path:
    project = tmp_path / "project"
    project.mkdir()
    (project / "app.py").write_text(APP)
    git(project, "init", "-q", "-b", "main")
    git(project, "config", "user.email", "t@example.com")
    git(project, "config", "user.name", "t")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "add health")
    return project


def test_freshness_tracks_the_handler_not_the_repo_head(tmp_path: Path) -> None:
    project = git_project(tmp_path)
    handler = discover(project).endpoints[0]
    first = handler_commit(project, handler)
    assert first is not None

    # An unrelated commit must not make the tests look stale.
    (project / "README.md").write_text("# docs\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "docs only")
    assert handler_commit(project, handler) == first

    # Changing the handler itself must.
    (project / "app.py").write_text(APP.replace('"status": "ok"', '"status": "fine"'))
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "change the health payload")
    changed = handler_commit(project, handler)
    assert changed is not None and changed != first


def test_reconcile_route_reports_the_suite(tmp_path: Path) -> None:
    project = git_project(tmp_path)
    repo = Repo.init(tmp_path / "repo")
    client = TestClient(create_app(repo=repo, provider=FakeProvider()))

    response = client.post(
        "/api/v1/endpoints/tests/reconcile", json={"project_path": str(project)}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["project_path"] == str(project)
    assert body["stale"] == 0
    assert body["retired"] == 0


def test_staleness_route_is_scoped_to_one_endpoint(tmp_path: Path) -> None:
    project = git_project(tmp_path)
    repo = Repo.init(tmp_path / "repo")
    client = TestClient(create_app(repo=repo, provider=FakeProvider()))

    response = client.get(
        "/api/v1/endpoints/tests/staleness",
        params={"project_path": str(project), "endpoint_id": "get /health"},
    )
    assert response.status_code == 200
    assert response.json()["files"] == []
