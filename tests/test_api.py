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


def test_chat_sse_streams_and_commits(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    provider = FakeProvider(default="A deterministic answer")
    client = TestClient(create_app(repo=repo, provider=provider))
    response = client.post(
        "/api/v1/chat/stream",
        json={
            "prompt": "What next?",
            "branch": "main",
            "commit_id": repo.log()[0].id,
            "model": "fake",
        },
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "event: token" in response.text
    chunks = [
        json.loads(line[6:])["text"]
        for line in response.text.splitlines()
        if line.startswith("data: ") and '"text"' in line
    ]
    assert "".join(chunks) == "A deterministic answer"
    assert "event: done" in response.text
    assert [message.content for message in repo.log()[0].messages] == [
        "What next?",
        "A deterministic answer",
    ]


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

    assert client.delete(f"/api/v1/sessions/{session['id']}").status_code == 204
    missing = client.post(f"/api/v1/sessions/{session['id']}/commit", json={})
    assert missing.status_code == 404


def test_chat_stream_with_session_stages_when_not_auto_commit(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    provider = FakeProvider(default="parked for review")
    client = TestClient(create_app(repo=repo, provider=provider))
    session = client.post(
        "/api/v1/sessions", json={"name": "careful chat", "auto_commit": False}
    ).json()
    response = client.post(
        "/api/v1/chat/stream",
        json={"prompt": "think first", "session_id": session["id"], "model": "fake"},
    )
    assert response.status_code == 200
    done_line = next(
        line
        for line in response.text.splitlines()
        if line.startswith("data: ") and "staged" in line
    )
    done = json.loads(done_line[6:])
    assert done["staged"] is True
    assert done["commit_id"] is None
    staged = client.get(f"/api/v1/sessions/{session['id']}/staging").json()
    assert [item["content"] for item in staged] == ["think first", "parked for review"]
    assert len(repo.log(session["branch"])) == 1  # nothing committed yet

    committed = client.post(f"/api/v1/sessions/{session['id']}/commit", json={})
    assert committed.status_code == 200
    assert len(repo.log(session["branch"])) == 2

    failed = client.post(f"/api/v1/sessions/{session['id']}/commit", json={})
    assert failed.status_code == 409  # staging now empty


def test_chat_stream_with_session_auto_commit_commits(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    client = TestClient(create_app(repo=repo, provider=FakeProvider(default="instant")))
    session = client.post(
        "/api/v1/sessions", json={"name": "fast chat", "auto_commit": True}
    ).json()
    response = client.post(
        "/api/v1/chat/stream",
        json={"prompt": "go", "session_id": session["id"], "model": "fake"},
    )
    assert '"staged": false' in response.text
    assert len(repo.log(session["branch"])) == 2  # root + committed turn


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


def test_compare_and_domain_error_mapping(tmp_path: Path) -> None:
    repo = seeded_repo(tmp_path / "repo")
    client = TestClient(create_app(repo=repo, provider=FakeProvider(default="answer")))
    result = client.post(
        "/api/v1/compare",
        json={"prompt": "Which design?", "branch_a": "main", "branch_b": "source", "model": "fake"},
    )
    assert result.status_code == 200
    assert result.json()["answer_a"] == result.json()["answer_b"] == "answer"
    assert result.json()["diff"]["ancestor_id"]
    missing = client.get("/api/v1/commits", params={"branch": "missing"})
    assert missing.status_code == 404


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

    refused = client.delete("/api/v1/branches", params={"name": "main"})
    assert refused.status_code == 422
