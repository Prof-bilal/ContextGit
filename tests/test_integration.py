"""No inference: real temporary Git repos and deterministic structured runners."""

import difflib
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from contextgit.api.app import create_app
from contextgit.core.repo import Repo
from contextgit.integration.service import IntegrationService, git


class FakeRunner:
    def __init__(self):
        self.reviews = 0
        self.callback = None
        self.verdict = "approve"

    def capability(self, harness):
        return harness

    def review(self, harness, prompt, cancel, usage):
        self.reviews += 1
        payload = json.loads(prompt)
        usage({"total_tokens": 100})
        if self.callback:
            self.callback()
        patch = ""
        for path, versions in payload["conflicts"].items():
            text = versions["source"] + "\n" + versions["target"] + "\n"
            patch += "".join(
                difflib.unified_diff(
                    versions["working"].splitlines(keepends=True),
                    text.splitlines(keepends=True),
                    fromfile="a/" + path,
                    tofile="b/" + path,
                )
            )
        return {"verdict": self.verdict, "feedback": "fixture review", "patch": patch}


@pytest.fixture
def setup(tmp_path):
    project = tmp_path / "project"
    project.mkdir()
    git(project, "init", "-b", "main")
    git(project, "config", "user.name", "Tester")
    git(project, "config", "user.email", "test@example.com")
    (project / ".gitignore").write_text(".contextgit/\nAGENTS.md\n.mcp.json\n")
    (project / "shared.txt").write_text("original\n")
    git(project, "add", ".")
    git(project, "commit", "-m", "initial")
    repo = Repo.init(tmp_path / "context")
    runner = FakeRunner()
    service = IntegrationService(repo, runner)
    repo._integration = service
    session = repo.create_session("worker", project_path=str(project), worktree=True)
    worker = Path(session.worktree_path)
    (worker / "worker.txt").write_text("worker\n")
    git(worker, "add", ".")
    git(worker, "commit", "-m", "worker change")
    service.configure(str(project), "codex", "main", "test -f worker.txt", "enabled")
    return repo, project, session, service, runner


def test_manual_default_checks_dirty_and_duplicate(setup):
    repo, project, session, service, runner = setup
    assert IntegrationService(repo, runner).settings(str(project))["authority"] == "enabled"
    with pytest.raises(ValueError, match="check command"):
        service.configure(str(project), "codex", "main", "", "enabled")
    first = service.ready(session.id)
    assert service.ready(session.id)["id"] == first["id"]
    assert len(service.jobs(str(project))) == 1
    (Path(session.worktree_path) / "dirty").write_text("dirty")
    with pytest.raises(ValueError, match="clean"):
        service.ready(session.id)


def test_clean_merge_preserves_worker_and_reviews(setup):
    _, project, session, service, runner = setup
    source = git(session.worktree_path, "rev-parse", "HEAD")
    job = service.ready(session.id)
    result = service.process(job["id"])
    assert result["state"] == "succeeded", result
    assert runner.reviews == 1
    assert (project / "worker.txt").read_text() == "worker\n"
    assert git(session.worktree_path, "rev-parse", "HEAD") == source
    assert result["source_sha"] == source
    assert result["usage"]["reading"]["total_tokens"] == 100
    assert git(project, "rev-parse", "HEAD") == result["candidate_commit"]


@pytest.mark.parametrize(
    "failure", ["dirty_target", "checks", "revoke", "cancel", "uncertain", "source_move"]
)
def test_failure_never_changes_main(setup, failure):
    _, project, session, service, runner = setup
    if failure == "checks":
        service.configure(str(project), "codex", "main", "echo fixture-failure; exit 7", "enabled")
    if failure == "dirty_target":
        (project / "shared.txt").write_text("user edit\n")
    if failure == "uncertain":
        runner.verdict = "uncertain"
    job = service.ready(session.id)
    before = git(project, "rev-parse", "main")
    if failure == "revoke":
        runner.callback = lambda: service.configure(
            str(project), "codex", "main", "true", "disabled"
        )
    if failure == "cancel":
        runner.callback = lambda: service.cancel(job["id"])
    if failure == "source_move":

        def move():
            git(session.worktree_path, "commit", "--allow-empty", "-m", "moved")

        runner.callback = move
    result = service.process(job["id"])
    assert result["state"] in {"failed", "cancelled"}, result
    assert git(project, "rev-parse", "main") == before
    if failure == "dirty_target":
        assert (project / "shared.txt").read_text() == "user edit\n"
    if failure == "checks":
        assert "fixture-failure" in result["check_output"]


def test_conflict_and_sequential_workers(setup):
    repo, project, session, service, _ = setup
    (Path(session.worktree_path) / "shared.txt").write_text("worker version\n")
    git(session.worktree_path, "add", ".")
    git(session.worktree_path, "commit", "-m", "worker shared")
    second = repo.create_session("second", project_path=str(project), worktree=True)
    (Path(second.worktree_path) / "second.txt").write_text("second\n")
    git(second.worktree_path, "add", ".")
    git(second.worktree_path, "commit", "-m", "second")
    (project / "shared.txt").write_text("target version\n")
    git(project, "add", ".")
    git(project, "commit", "-m", "target shared")
    first_job = service.ready(session.id)
    second_job = service.ready(second.id)
    result = service.process(first_job["id"])
    assert result["state"] == "succeeded", result
    assert result["conflicts"] == ["shared.txt"]
    assert "worker version" in (project / "shared.txt").read_text()
    assert "target version" in (project / "shared.txt").read_text()
    assert service.process(second_job["id"])["state"] == "succeeded"
    assert (project / "worker.txt").exists() and (project / "second.txt").exists()


def test_moving_target_rebuilds_and_unchecked_out_target(setup):
    _, project, session, service, runner = setup
    job = service.ready(session.id)

    def move():
        runner.callback = None
        (project / "new.txt").write_text("new\n")
        git(project, "add", ".")
        git(project, "commit", "-m", "target moved")
        git(project, "checkout", "-b", "other")

    runner.callback = move
    result = service.process(job["id"])
    assert result["state"] == "succeeded", result
    assert runner.reviews == 2
    assert git(project, "branch", "--show-current") == "other"
    assert git(project, "show", "main:new.txt") == "new"
    assert git(project, "show", "main:worker.txt") == "worker"


def test_restart_reconciliation_and_retry(setup):
    _, project, session, service, _ = setup
    job = service.ready(session.id)
    service.save(job, state="reviewing")
    service.recover()
    assert service.job(job["id"])["state"] == "interrupted"
    service.retry(job["id"])
    result = service.process(job["id"])
    assert result["state"] == "succeeded"
    service.save(result, state="publishing")
    service.recover()
    assert service.job(job["id"])["state"] == "succeeded"


def test_authenticated_api(setup, monkeypatch):
    repo, project, session, service, _ = setup
    monkeypatch.setenv("CONTEXTGIT_API_TOKEN", "fixture-token")
    client = TestClient(create_app(repo=repo))
    url = "/api/v1/integration/settings"
    assert client.get(url, params={"project": str(project)}).status_code == 401
    headers = {"Authorization": "Bearer fixture-token"}
    assert client.get(url, params={"project": str(project)}, headers=headers).status_code == 200
    result = client.post(f"/api/v1/integration/ready/{session.id}", headers=headers)
    assert result.status_code == 200
    assert service.job(result.json()["id"])["state"] == "queued"


def test_team_integration_releases_dependency(setup):
    repo, project, _, service, _ = setup
    team = repo.create_team("team", project_path=str(project))
    task = repo.create_task(team.id, title="first", agent="shell")
    dependent = repo.create_task(team.id, title="dependent", depends_on=[task.id], agent="shell")
    task = repo.start_task(task.id)
    session = repo.get_session(task.session_id)
    (Path(session.worktree_path) / "worker.txt").write_text("team worker\n")
    git(session.worktree_path, "add", ".")
    git(session.worktree_path, "commit", "-m", "team worker")
    assert repo.complete_task(task.id).status == "review"
    job = next(job for job in service.jobs() if job["task_id"] == task.id)
    assert repo.get_task(dependent.id).status != "working"
    result = service.process(job["id"])
    assert result["state"] == "succeeded", result
    assert repo.get_task(task.id).status == "done"
    assert repo.get_task(dependent.id).status == "working"


def test_cancelled_retry_and_paused_default(setup):
    _, project, session, service, _ = setup
    job = service.ready(session.id)
    service.cancel(job["id"])
    assert service.process(job["id"])["state"] == "cancelled"
    assert service.retry(job["id"])["state"] == "queued"
    assert service.process(job["id"])["state"] == "succeeded"
    service.configure(str(project), "codex", "main", "true", "paused")
    with pytest.raises(ValueError, match="not enabled"):
        service.ready(session.id)


def test_unrelated_patch_rejected(setup):
    _, project, session, service, runner = setup
    before = git(project, "rev-parse", "main")

    def review(*args):
        return {"verdict": "approve", "feedback": "", "patch": "unrelated patch"}

    runner.review = review
    result = service.process(service.ready(session.id)["id"])
    assert result["state"] == "failed"
    assert "cannot modify" in result["feedback"]
    assert git(project, "rev-parse", "main") == before


@pytest.mark.parametrize("kind", ["modify_delete", "rename_delete"])
def test_delete_and_rename_conflicts(setup, kind):
    _, project, session, service, _ = setup
    worker = Path(session.worktree_path)
    if kind == "rename_delete":
        git(worker, "mv", "shared.txt", "renamed.txt")
    else:
        (worker / "shared.txt").write_text("worker changed\n")
        git(worker, "add", ".")
    git(worker, "commit", "-m", kind)
    git(project, "rm", "shared.txt")
    git(project, "commit", "-m", "target deleted")
    before = git(project, "rev-parse", "HEAD")
    result = service.process(service.ready(session.id)["id"])
    assert result["state"] == "succeeded", result
    assert result["conflicts"]
    assert (project / ("renamed.txt" if kind == "rename_delete" else "shared.txt")).exists()
    assert git(project, "rev-parse", "HEAD") != before


def test_active_target_operation_blocks_publication(setup):
    _, project, session, service, _ = setup
    before = git(project, "rev-parse", "HEAD")
    (project / ".git" / "CHERRY_PICK_HEAD").write_text(before + "\n")
    result = service.process(service.ready(session.id)["id"])
    assert result["state"] == "failed"
    assert "active Git operation" in result["feedback"]
    assert git(project, "rev-parse", "HEAD") == before


def test_two_invalid_resolution_attempts_stop(setup):
    _, project, session, service, runner = setup
    worker = Path(session.worktree_path)
    (worker / "shared.txt").write_text("worker\n")
    git(worker, "add", ".")
    git(worker, "commit", "-m", "worker")
    (project / "shared.txt").write_text("target\n")
    git(project, "add", ".")
    git(project, "commit", "-m", "target")
    calls = []

    def review(*args):
        calls.append(1)
        return {"verdict": "approve", "feedback": "", "patch": "malformed patch"}

    runner.review = review
    before = git(project, "rev-parse", "main")
    result = service.process(service.ready(session.id)["id"])
    assert result["state"] == "failed"
    assert len(calls) == 2
    assert git(project, "rev-parse", "main") == before


def test_pause_and_resume_preserves_queued_generation(setup):
    _, project, session, service, _ = setup
    job = service.ready(session.id)
    paused = service.configure(str(project), "codex", "main", "test -f worker.txt", "paused")
    assert paused["generation"] == job["generation"]
    resumed = service.configure(str(project), "codex", "main", "test -f worker.txt", "enabled")
    assert resumed["generation"] == job["generation"]
    assert service.process(job["id"])["state"] == "succeeded"


def test_backend_owns_background_job_without_renderer(setup):
    import time

    _, project, session, service, _ = setup
    job = service.ready(session.id)
    service.start()
    try:
        deadline = time.monotonic() + 5
        while service.job(job["id"])["state"] != "succeeded" and time.monotonic() < deadline:
            time.sleep(0.05)
        assert service.job(job["id"])["state"] == "succeeded"
    finally:
        service.stop()


def test_new_project_without_main_requires_branch_selection(setup):
    repo, project, _, _, runner = setup
    other = project.parent / "no-main"
    other.mkdir()
    git(other, "init", "-b", "develop")
    git(other, "config", "user.name", "Test")
    git(other, "config", "user.email", "test@example.com")
    git(other, "commit", "--allow-empty", "-m", "initial")
    service = IntegrationService(repo, runner)
    settings = service.settings(str(other))
    assert settings["authority"] == "disabled"
    assert settings["target"] == ""
    assert settings["branches"] == ["develop"]
    with pytest.raises(ValueError):
        service.configure(str(other), "codex", "", "true", "enabled")


def test_corrected_second_patch_starts_from_original_conflict(setup):
    _, project, session, service, runner = setup
    worker = Path(session.worktree_path)
    (worker / "shared.txt").write_text("worker\n")
    git(worker, "add", ".")
    git(worker, "commit", "-m", "worker")
    (project / "shared.txt").write_text("target\n")
    git(project, "add", ".")
    git(project, "commit", "-m", "target")
    original_review = runner.review
    calls = []

    def review(harness, prompt, cancel, usage):
        calls.append(1)
        if len(calls) == 1:
            payload = json.loads(prompt)
            text = payload["conflicts"]["shared.txt"]["working"]
            # Applies cleanly but retains markers, exercising transactional rollback.
            patch = "".join(
                difflib.unified_diff(
                    text.splitlines(keepends=True),
                    (text + "extra\n").splitlines(keepends=True),
                    fromfile="a/shared.txt",
                    tofile="b/shared.txt",
                )
            )
            return {"verdict": "approve", "feedback": "", "patch": patch}
        return original_review(
            harness, prompt.split("\nPatch validation failed:")[0], cancel, usage
        )

    runner.review = review
    result = service.process(service.ready(session.id)["id"])
    assert result["state"] == "succeeded", result
    assert len(calls) == 2
    assert "extra" not in (project / "shared.txt").read_text()


def test_target_cannot_be_a_worker_branch(setup):
    _, project, session, service, _ = setup
    with pytest.raises(ValueError, match="worker branch"):
        service.configure(str(project), "codex", session.git_branch, "true", "enabled")
