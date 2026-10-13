"""FastAPI route integration tests run against temporary SQLite repositories."""

import json
from pathlib import Path

from fastapi.testclient import TestClient

from contextgit.api.app import create_app
from contextgit.core.models import Message
from contextgit.core.repo import Repo
from contextgit.llm.fake import FakeProvider


def seeded_repo(path: Path) -> Repo:
    repo = Repo.init(path)
    repo.commit([Message(role="user", content="shared design")], model="test")
    repo.branch("source")
    repo.commit([Message(role="user", content="try Redis")], model="test", branch="source")
    repo.commit([Message(role="user", content="keep audit logging")], model="test", branch="main")
    return repo


def test_snapshot_and_branch_commit_context(tmp_path: Path) -> None:
    repo = seeded_repo(tmp_path / "repo")
    client = TestClient(create_app(repo=repo, provider=FakeProvider()))
    snapshot = client.get("/api/v1/repo")
    assert snapshot.status_code == 200
    assert len(snapshot.json()["commits"]) == 4
    created = client.post(
        "/api/v1/branches", json={"name": "fork", "from_commit": repo.log("source")[0].id}
    )
    assert created.status_code == 200
    assert created.json()["name"] == "fork"
    context = client.get("/api/v1/context", params={"branch": "source"})
    assert [item["content"] for item in context.json()][-1] == "try Redis"
    commit = client.post(
        "/api/v1/commits",
        json={
            "messages": [{"role": "user", "content": "continue"}],
            "model": "test",
            "branch": "source",
        },
    )
    assert commit.status_code == 200
    assert commit.json()["commit"]["messages"][0]["content"] == "continue"


def test_duplicate_branch_returns_validation_error(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    client = TestClient(create_app(repo=repo, provider=FakeProvider()))
    response = client.post("/api/v1/branches", json={"name": "main"})
    assert response.status_code == 422
    assert response.json()["type"] == "InvalidRefName"


def test_session_routes_stage_and_commit(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    client = TestClient(create_app(repo=repo, provider=FakeProvider()))
    created = client.post(
        "/api/v1/sessions",
        json={"name": "claude run", "kind": "terminal", "agent": "claude"},
    )
    assert created.status_code == 201
    session = created.json()
    assert session["kind"] == "terminal"
    assert session["branch"]
    listed = client.get("/api/v1/sessions")
    assert [item["id"] for item in listed.json()] == [session["id"]]

    staged = client.post(
        f"/api/v1/sessions/{session['id']}/staging",
        json={"messages": [{"role": "user", "content": "half done"}]},
    )
    assert staged.status_code == 200
    assert len(staged.json()) == 1

    updated = client.patch(f"/api/v1/sessions/{session['id']}", json={"status": "running"})
    assert updated.json()["status"] == "running"

    committed = client.post(
        f"/api/v1/sessions/{session['id']}/commit",
        json={"summary": "checkpoint"},
    )
    assert committed.status_code == 200
    assert committed.json()["commit"]["summary"] == "checkpoint"
    assert client.get(f"/api/v1/sessions/{session['id']}/staging").json() == []

    # A plain delete moves the run to Storage; only permanent=true drops it.
    assert client.delete(f"/api/v1/sessions/{session['id']}").status_code == 204
    assert [item["id"] for item in client.get("/api/v1/trash").json()["sessions"]] == [
        session["id"]
    ]
    assert session["id"] not in {item["id"] for item in client.get("/api/v1/sessions").json()}
    restored = client.post(f"/api/v1/sessions/{session['id']}/restore")
    assert restored.status_code == 200
    assert restored.json()["deleted_at"] is None
    assert session["id"] in {item["id"] for item in client.get("/api/v1/sessions").json()}

    assert (
        client.delete(f"/api/v1/sessions/{session['id']}", params={"permanent": "true"}).status_code
        == 204
    )
    missing = client.post(f"/api/v1/sessions/{session['id']}/commit", json={})
    assert missing.status_code == 404


def test_merge_preview_requires_resolution_then_applies(tmp_path: Path) -> None:
    repo = seeded_repo(tmp_path / "repo")
    provider = FakeProvider(
        default=json.dumps(
            {
                "decisions": ["Use Redis"],
                "facts": [],
                "dead_ends": [],
                "open_questions": [],
                "conflicts": [
                    {
                        "id": "logging",
                        "category": "decision",
                        "topic": "logging",
                        "source": "sample logs",
                        "target": "log all requests",
                    }
                ],
                "summary": "Use Redis and selected logging policy.",
            }
        )
    )
    client = TestClient(create_app(repo=repo, provider=provider))
    preview_response = client.post(
        "/api/v1/merge/preview", json={"source": "source", "into": "main"}
    )
    assert preview_response.status_code == 200
    preview = preview_response.json()
    assert preview["ancestor_id"]
    assert preview["conflicts"][0]["id"] == "logging"
    before = repo.log("main")[0].id
    unresolved = client.post("/api/v1/merge/apply", json={"preview": preview})
    assert unresolved.status_code == 409
    assert repo.log("main")[0].id == before
    applied = client.post(
        "/api/v1/merge/apply",
        json={"preview": preview, "resolutions": {"logging": "source"}},
    )
    assert applied.status_code == 200
    assert len(applied.json()["commit"]["parent_ids"]) == 2


def test_branch_budget_and_blame(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    repo.commit([Message(role="user", content="shared design")], model="test")
    repo.commit([Message(role="assistant", content="the answer")], model="test")
    client = TestClient(create_app(repo=repo, provider=FakeProvider()))

    budget = client.get("/api/v1/branches/main/budget")
    assert budget.status_code == 200
    assert budget.json()["messages"] == 2
    assert budget.json()["used"] > 0
    assert budget.json()["head"] == repo.log()[0].id

    blame = client.get("/api/v1/branches/main/blame").json()
    assert [entry["role"] for entry in blame] == ["user", "assistant"]
    assert [entry["content"] for entry in blame] == ["shared design", "the answer"]
    # Oldest message belongs to the older commit.
    assert blame[0]["commit_id"] == repo.log()[1].id
    assert blame[1]["commit_id"] == repo.log()[0].id

    missing = client.get("/api/v1/branches/nope/budget")
    assert missing.status_code == 404


def test_delete_branch_keeps_commits_and_refuses_current(tmp_path: Path) -> None:
    repo = seeded_repo(tmp_path / "repo")
    client = TestClient(create_app(repo=repo, provider=FakeProvider()))
    commits_before = len(client.get("/api/v1/repo").json()["commits"])

    deleted = client.delete("/api/v1/branches", params={"name": "source"})
    assert deleted.status_code == 204

    after = client.get("/api/v1/repo").json()
    assert {branch["name"] for branch in after["branches"]} == {"main"}
    # Only the pointer went; every commit is still reachable from main.
    assert len(after["commits"]) == commits_before

    # The branch is in Storage and comes back on restore.
    assert {branch["name"] for branch in client.get("/api/v1/trash").json()["branches"]} == {"source"}
    assert client.post("/api/v1/branches/restore", params={"name": "source"}).status_code == 200
    assert {branch["name"] for branch in client.get("/api/v1/repo").json()["branches"]} == {
        "main",
        "source",
    }

    # Permanent delete drops the pointer for good.
    assert (
        client.delete("/api/v1/branches", params={"name": "source", "permanent": "true"}).status_code
        == 204
    )
    assert {branch["name"] for branch in client.get("/api/v1/trash").json()["branches"]} == set()

    refused = client.delete("/api/v1/branches", params={"name": "main"})
    assert refused.status_code == 422
