"""The finish → feedback → review → resume contract, including failure recovery."""

import json
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from contextgit.api.app import create_app
from contextgit.core.models import Message
from contextgit.core.repo import Repo
from contextgit.llm.fake import FakeProvider


def reply(**changes):
    return json.dumps(
        {
            "title": "Validate authentication",
            "instruction": "Run authentication tests before finishing.",
            "rationale": "The earlier attempt missed a failing authentication case.",
            "evidence": "The authentication test failed.",
            "confidence": "medium",
            "kind": "validation",
            "conflicts": [],
            **changes,
        }
    )


@pytest.fixture
def setup(tmp_path):
    project = tmp_path / "project"
    project.mkdir()
    repo = Repo.init(project / ".contextgit")
    session = repo.create_session(
        "Fix authentication",
        project_path=str(project),
        category="Authentication",
        scope=["src/auth/**"],
    )
    repo.stage(
        session.id,
        [
            Message(role="user", content="Fix authentication."),
            Message(role="assistant", content="The authentication test failed."),
        ],
    )
    provider = FakeProvider(default=reply())
    client = TestClient(create_app(repo=repo, provider=provider))
    yield repo, session, project, client, provider
    repo._storage.close()


def test_finish_rate_learn_approve_resume(setup):
    repo, session, project, client, provider = setup
    route = f"/api/v1/sessions/{session.id}"
    checkpoint = client.post(route + "/checkpoint").json()["checkpoint"]
    assert not list((project / ".contextgit").glob("knowledge/**/*.md"))
    assert client.post(route + "/checkpoint").json()["changed"] is False
    feedback = client.post(
        route + "/feedback",
        json={
            "rating": 1,
            "tags": ["incorrect"],
            "category": "Authentication",
            "note": "Tests failed",
        },
    )
    assert feedback.status_code == 200
    assert repo.get_session(session.id).category == "Authentication"
    exported = client.post(
        route + "/checkpoint/export",
        json={"checkpoint_id": checkpoint["id"], "markdown": checkpoint["markdown"]},
    )
    assert exported.status_code == 200
    assert (project / exported.json()["artifact_path"]).read_text() == checkpoint["markdown"]
    draft = client.post(route + "/learning-draft", json={}).json()
    assert draft["status"] == "draft"
    preflight = {
        "project_path": str(project),
        "category": "Authentication",
        "task": "Fix authentication",
    }
    before = client.post("/api/v1/knowledge/preflight", json=preflight).json()
    assert len(before["warnings"]) == 1
    assert before["lessons"] == []
    assert draft["instruction"] not in (project / "AGENTS.md").read_text()
    approval = client.post(
        f"/api/v1/project-memory/drafts/{draft['id']}/approve",
        json={"instruction": draft["instruction"]},
    )
    assert approval.status_code == 200
    assert approval.json()["status"] == "approved"
    assert list(project.glob(".contextgit/knowledge/skills/*/SKILL.md"))
    assert "Reviewed project skills" in (project / "AGENTS.md").read_text()
    after = client.post("/api/v1/knowledge/preflight", json=preflight).json()
    assert after["lessons"][0]["instruction"] == draft["instruction"]
    elsewhere = client.post(
        "/api/v1/knowledge/preflight", json={**preflight, "category": "UI"}
    ).json()
    assert elsewhere["lessons"] == []
    scoped = client.post(
        "/api/v1/knowledge/preflight",
        json={**preflight, "category": "", "scope": ["src/auth/login.py"]},
    ).json()
    assert scoped["lessons"]
    assert provider.calls
    reopened = Repo.open(project / ".contextgit")
    assert reopened.knowledge.latest(session.id).feedback.rating == 1
    reopened._storage.close()


def test_empty_and_changed_checkpoint(setup):
    repo, session, project, client, _ = setup
    empty = repo.create_session("Empty", project_path=str(project))
    assert client.post(f"/api/v1/sessions/{empty.id}/checkpoint").json()["status"] == "empty"
    route = f"/api/v1/sessions/{session.id}/checkpoint"
    first = client.post(route).json()["checkpoint"]
    repo.stage(session.id, [Message(role="assistant", content="A new response.")])
    changed = client.post(route).json()
    assert changed["changed"] is True
    assert changed["checkpoint"]["id"] != first["id"]
    assert repo.knowledge.get_checkpoint(first["id"]).markdown == first["markdown"]


def test_redaction_export_and_external_edits(setup):
    repo, session, project, client, provider = setup
    secret = "sk-" + "s" * 32
    repo.stage(session.id, [Message(role="user", content=f"api_key={secret}\npassword=hunter22")])
    route = f"/api/v1/sessions/{session.id}"
    checkpoint = client.post(route + "/checkpoint").json()["checkpoint"]
    assert checkpoint["redactions"] >= 2
    assert secret not in checkpoint["markdown"]
    body = {
        "checkpoint_id": checkpoint["id"],
        "markdown": checkpoint["markdown"] + f"\nBearer {secret}",
    }
    exported = client.post(route + "/checkpoint/export", json=body).json()
    path = project / exported["artifact_path"]
    assert secret not in path.read_text()
    path.write_text("user edits")
    response = client.post(route + "/checkpoint/export", json=body)
    assert response.status_code == 409
    assert path.read_text() == "user edits"
    client.post(route + "/learning-draft", json={})
    assert secret not in str(provider.calls)


def test_cross_project_and_wrong_session_export(setup, tmp_path):
    repo, session, project, client, _ = setup
    cp = client.post(f"/api/v1/sessions/{session.id}/checkpoint").json()["checkpoint"]
    other_project = tmp_path / "other"
    other_project.mkdir()
    other = repo.create_session("Other", project_path=str(other_project))
    response = client.post(
        f"/api/v1/sessions/{other.id}/checkpoint/export",
        json={"checkpoint_id": cp["id"], "markdown": "wrong"},
    )
    assert response.status_code == 409
    data = client.get("/api/v1/knowledge", params={"project_path": str(other_project)}).json()
    assert data["checkpoints"] == []


def test_rejected_conflicting_stale_and_unsupported_lessons(setup):
    repo, session, project, client, provider = setup
    route = f"/api/v1/sessions/{session.id}"
    client.post(route + "/checkpoint")
    provider._default = reply(conflicts=["Existing instructions require another test command."])
    draft = client.post(route + "/learning-draft", json={}).json()
    approve = f"/api/v1/project-memory/drafts/{draft['id']}/approve"
    assert client.post(approve, json={"instruction": "New command"}).status_code == 409
    rejected = client.post(f"/api/v1/project-memory/drafts/{draft['id']}/reject")
    assert rejected.json()["status"] == "rejected"
    provider._default = reply()
    draft = client.post(route + "/learning-draft", json={}).json()
    client.post(route + "/feedback", json={"rating": 2})
    assert (
        client.post(
            f"/api/v1/project-memory/drafts/{draft['id']}/approve",
            json={"instruction": draft["instruction"]},
        ).status_code
        == 409
    )
    provider._default = reply(evidence="This never happened")
    assert client.post(route + "/learning-draft", json={}).status_code == 409
    provider._default = "not JSON"
    assert client.post(route + "/learning-draft", json={}).status_code == 409


def test_terminal_partial_capture_and_provider_failure(setup):
    repo, session, project, client, provider = setup
    terminal = repo.create_session(
        "Terminal task", agent="codex", kind="terminal", project_path=str(project)
    )
    repo.append_terminal_transcript(terminal.id, "Authentication test: FAIL")
    cp = client.post(f"/api/v1/sessions/{terminal.id}/checkpoint").json()["checkpoint"]
    assert cp["capture_status"] == "partial"
    assert cp["warning"]

    class Broken(FakeProvider):
        def complete(self, messages, **opts):
            raise RuntimeError("Provider unavailable")

    failing = TestClient(create_app(repo=repo, provider=Broken()))
    assert (
        failing.post(f"/api/v1/sessions/{terminal.id}/learning-draft", json={}).status_code == 502
    )
    assert failing.get(f"/api/v1/sessions/{terminal.id}/checkpoint").json()["id"] == cp["id"]


def test_cleaning_preserves_source_and_does_not_export(setup):
    repo, session, project, client, provider = setup
    route = f"/api/v1/sessions/{session.id}"
    original = client.post(route + "/checkpoint").json()["checkpoint"]
    provider._default = "## Outcome\nAuthentication test failed; task unfinished."
    result = client.post(route + "/checkpoint/clean", json={})
    assert result.status_code == 200
    assert "AI-cleaned summary" in result.json()["markdown"]
    assert repo.knowledge.latest(session.id).markdown == original["markdown"]
    assert repo.knowledge.latest(session.id).artifact_path is None


def test_symlink_export_is_rejected(setup, tmp_path):
    repo, session, project, client, _ = setup
    route = f"/api/v1/sessions/{session.id}"
    cp = client.post(route + "/checkpoint").json()["checkpoint"]
    target = tmp_path / "outside"
    target.mkdir()
    (project / ".contextgit" / "knowledge").symlink_to(target, target_is_directory=True)
    response = client.post(
        route + "/checkpoint/export", json={"checkpoint_id": cp["id"], "markdown": "content"}
    )
    assert response.status_code == 409
    assert not list(target.iterdir())


def test_approved_guidance_reaches_matching_worktrees_and_preserves_claims(setup):
    repo, session, project, client, _ = setup

    def git(*args):
        subprocess.run(["git", *args], cwd=project, check=True, capture_output=True)

    git("init", "-q", "-b", "main")
    git("config", "user.email", "test@example.com")
    git("config", "user.name", "Test")
    (project / "README.md").write_text("Example project\n")
    git("add", "README.md")
    git("commit", "-qm", "initial")
    route = f"/api/v1/sessions/{session.id}"
    client.post(route + "/checkpoint")
    draft = client.post(route + "/learning-draft", json={}).json()
    assert (
        client.post(
            f"/api/v1/project-memory/drafts/{draft['id']}/approve",
            json={"instruction": draft["instruction"]},
        ).status_code
        == 200
    )
    matching = repo.create_session(
        "Auth followup",
        project_path=str(project),
        category="Authentication",
        scope=["src/auth/**"],
        worktree=True,
    )
    unrelated = repo.create_session(
        "UI followup", project_path=str(project), category="UI", scope=["src/ui/**"], worktree=True
    )
    body = (Path(matching.worktree_path) / "AGENTS.md").read_text()
    other_body = (Path(unrelated.worktree_path) / "AGENTS.md").read_text()
    assert draft["instruction"] in body
    assert draft["instruction"] not in other_body
    assert "Auth followup" in body and "UI followup" in body
    assert "src/auth/**" in body and "src/ui/**" in body


def test_feedback_validation_and_unconfigured_provider_recovery(setup):
    repo, session, _, client, _ = setup
    route = f"/api/v1/sessions/{session.id}"
    client.post(route + "/checkpoint")
    for feedback in ({"rating": 0}, {"rating": 6}, {"rating": 1, "tags": ["unknown"]}):
        assert client.post(route + "/feedback", json=feedback).status_code == 422
    offline = TestClient(create_app(repo=repo))
    response = offline.post(route + "/learning-draft", json={})
    assert response.status_code == 409
    assert "provider" in response.json()["detail"]
    assert offline.get(route + "/checkpoint").json()


def test_native_capture_failure_preserves_saved_messages(setup, monkeypatch):
    repo, session, _, client, _ = setup
    from contextgit.integration.transcript import CaptureUnavailable

    session.agent = "opencode"
    repo._storage.update_session(session)

    def unavailable(*args, **kwargs):
        raise CaptureUnavailable("missing", "Native history is unavailable.")

    monkeypatch.setattr(repo.transcripts, "capture", unavailable)
    monkeypatch.setattr(repo.transcripts, "conversation", unavailable)
    response = client.post(f"/api/v1/sessions/{session.id}/checkpoint")
    assert response.status_code == 200
    checkpoint = response.json()["checkpoint"]
    assert checkpoint["capture_status"] == "missing"
    assert "The authentication test failed." in checkpoint["markdown"]
    assert "unavailable" in checkpoint["warning"]
