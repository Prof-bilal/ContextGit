"""Standalone task workflow: TaskService and the `ctx task` commands."""

from __future__ import annotations

import json
import sqlite3
import subprocess
from pathlib import Path

import pytest
from typer.testing import CliRunner

from contextgit.cli.main import app
from contextgit.core.errors import (
    ContextGitError,
    InvalidTaskTransition,
    TaskDependencyError,
)
from contextgit.core.events import AgentEvent
from contextgit.core.repo import Repo
from contextgit.core.task_service import TaskService


@pytest.fixture
def service(repo: Repo) -> TaskService:
    return TaskService(repo)


@pytest.fixture
def project(tmp_path: Path) -> Path:
    """A git project for worktrees; the team points at it, not at the ContextGit repo."""
    root = tmp_path / "proj"
    root.mkdir()
    git = ["git", "-c", "user.email=t@example.com", "-c", "user.name=Tester"]
    subprocess.run([*git, "init", "-q", "-b", "main"], cwd=root, check=True)
    (root / "app.py").write_text("print('hi')\n")
    subprocess.run([*git, "add", "-A"], cwd=root, check=True)
    subprocess.run([*git, "commit", "-q", "-m", "init"], cwd=root, check=True)
    return root


@pytest.fixture
def team(repo: Repo, project: Path) -> None:
    repo.create_team("portal", project_path=str(project))


def test_create_makes_team_on_demand_and_reports_phases(service: TaskService, repo: Repo) -> None:
    assert repo.current_team() is None
    first = service.create("write parser", done_criteria="tests pass")
    second = service.create("wire cli", depends_on=[first.id])

    assert repo.current_team() is not None
    assert first.phase == "READY"
    assert second.phase == "BLOCKED"
    assert second.blocked_by == [first.id]
    assert [view.id for view in service.list_tasks()] == [first.id, second.id]


def test_unstarted_task_has_no_branch_worktree_or_run(service: TaskService) -> None:
    view = service.create("plain task")
    assert view.session_id is None
    assert view.branch is None
    assert view.worktree_path is None
    assert view.agent_run_id is None


def test_on_demand_team_points_at_the_project_not_the_metadata_dir(tmp_path: Path) -> None:
    project = tmp_path / "proj"
    project.mkdir()
    repo = Repo.init(project / ".contextgit")

    TaskService(repo).create("standalone")

    team = repo.current_team()
    assert team is not None
    assert team.name == "proj"
    assert team.project_path == str(project)


def test_stop_refused_for_a_task_that_is_not_running(service: TaskService) -> None:
    view = service.create("idle")
    with pytest.raises(InvalidTaskTransition):
        service.stop(view.id)


def test_stop_marks_running_task_failed(service: TaskService, repo: Repo) -> None:
    view = service.create("long job")
    repo._set_task_status(view.id, "working")  # a running task, without spawning a worktree

    stopped = service.stop(view.id, "user cancelled")

    assert stopped.phase == "FAILED"
    assert stopped.status == "failed"
    assert repo.get_task(view.id).review_note == "user cancelled"


def test_start_refused_once_implemented(service: TaskService, repo: Repo) -> None:
    view = service.create("done work")
    repo._set_task_status(view.id, "review")
    with pytest.raises(InvalidTaskTransition):
        service.start(view.id)


def test_start_is_idempotent_while_running(service: TaskService, repo: Repo) -> None:
    view = service.create("already going")
    repo._set_task_status(view.id, "working")
    assert service.start(view.id).phase == "RUNNING"


def test_start_blocked_task_names_its_dependency(service: TaskService) -> None:
    first = service.create("upstream")
    second = service.create("downstream", depends_on=[first.id])
    with pytest.raises(TaskDependencyError, match="upstream"):
        service.start(second.id)


def test_cli_create_then_list_as_json(
    repo_path: Path, repo: Repo, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(repo_path)
    runner = CliRunner()

    created = runner.invoke(app, ["task", "create", "cli task", "--json"])
    assert created.exit_code == 0, created.output
    payload = json.loads(created.output)
    assert payload["phase"] == "READY"

    listed = runner.invoke(app, ["task", "list", "--json"])
    assert listed.exit_code == 0, listed.output
    assert [item["id"] for item in json.loads(listed.output)] == [payload["id"]]


def test_cli_reports_domain_errors_without_traceback(
    repo_path: Path, repo: Repo, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(repo_path)
    runner = CliRunner()
    created = runner.invoke(app, ["task", "create", "idle", "--json"])
    task_id = json.loads(created.output)["id"]

    result = runner.invoke(app, ["task", "stop", task_id])

    assert result.exit_code == 1
    assert "error:" in result.output


def test_unstarted_view_defaults_to_terminal_capabilities(service: TaskService) -> None:
    view = service.create("no agent yet")
    assert view.capabilities["launch"] is True
    assert view.unsupported == ["transcript", "usage", "structured_review"]
    assert view.event_kinds == ["lifecycle"]


def test_start_with_agent_links_session_run_and_records_event(
    project: Path, team: None, service: TaskService, repo: Repo
) -> None:
    view = service.create("feature work")
    started = service.start(view.id, agent="codex")

    assert started.phase == "RUNNING"
    assert started.agent == "codex"
    assert started.branch is not None
    assert started.worktree_path is not None
    assert started.agent_run_id is not None
    assert started.capabilities["structured_review"] is True
    assert "transcript" in started.unsupported

    run = repo.agent_run(started.agent_run_id)
    assert run.session_id == started.session_id
    assert run.provider == "codex"
    assert run.status == "executing"

    events = repo.agent_events(view.id)
    assert [event.event_type for event in events] == ["lifecycle"]
    assert events[0].run_id == run.id
    assert events[0].source == "codex"


def test_unknown_agent_is_refused_before_anything_starts(
    project: Path, team: None, service: TaskService, repo: Repo
) -> None:
    view = service.create("bad agent")
    with pytest.raises(ContextGitError, match="unknown agent 'gpt'"):
        service.start(view.id, agent="gpt")
    assert service.show(view.id).session_id is None
    assert repo.agent_events(view.id) == []


def test_stop_closes_the_linked_run_and_records_an_event(
    project: Path, team: None, service: TaskService, repo: Repo
) -> None:
    view = service.create("to stop")
    started = service.start(view.id, agent="terminal")
    stopped = service.stop(view.id, "user cancelled")

    assert stopped.phase == "FAILED"
    run = repo.agent_run(started.agent_run_id)
    assert run.status == "failed"
    assert run.error == "user cancelled"
    assert [event.event_type for event in repo.agent_events(view.id)] == ["lifecycle", "status"]


def test_agent_events_are_append_only(service: TaskService, repo: Repo) -> None:
    view = service.create("log me")
    repo.append_agent_event(
        AgentEvent(id="evt-1", aggregate_id=view.id, event_type="message", source="codex")
    )

    with pytest.raises(sqlite3.Error, match="append-only"):
        repo._storage._conn.execute("UPDATE agent_events SET source = 'x' WHERE id = 'evt-1'")
    with pytest.raises(sqlite3.Error, match="append-only"):
        repo._storage._conn.execute("DELETE FROM agent_events WHERE id = 'evt-1'")

    assert [event.source for event in repo.agent_events(view.id)] == ["codex"]


def test_cli_start_with_unknown_agent_exits_1(
    repo_path: Path, repo: Repo, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(repo_path)
    runner = CliRunner()
    created = runner.invoke(app, ["task", "create", "cli start", "--json"])
    task_id = json.loads(created.output)["id"]

    result = runner.invoke(app, ["task", "start", task_id, "--agent", "gpt"])

    assert result.exit_code == 1
    assert "unknown agent" in result.output
    assert "Traceback" not in result.output


def test_start_refuses_a_different_agent_while_running(service: TaskService, repo: Repo) -> None:
    view = service.create("pinned")
    repo._set_task_status(view.id, "working")
    with pytest.raises(ContextGitError, match="already running on terminal"):
        service.start(view.id, agent="codex")


def test_retry_restarts_a_stopped_task_on_a_new_session(service: TaskService, team: None) -> None:
    view = service.create("flaky")
    started = service.start(view.id)
    stopped = service.stop(view.id, "crashed")

    retried = service.retry(view.id, agent="terminal")

    assert stopped.phase == "FAILED"
    assert retried.phase == "RUNNING"
    assert retried.session_id is not None
    assert retried.session_id != started.session_id


def test_retry_refused_for_a_task_that_never_failed(service: TaskService) -> None:
    view = service.create("fresh")
    with pytest.raises(InvalidTaskTransition):
        service.retry(view.id)


def test_parent_link_is_stored_and_shown(service: TaskService) -> None:
    parent = service.create("epic")
    child = service.create("subtask", parent_id=parent.id)

    assert child.parent_id == parent.id
    assert service.show(child.id).parent_id == parent.id


def test_approve_emits_a_status_event(service: TaskService, repo: Repo) -> None:
    view = service.create("reviewed")
    repo._set_task_status(view.id, "review")

    repo.approve_task(view.id)

    kinds = [
        (event.event_type, event.payload.get("transition")) for event in repo.agent_events(view.id)
    ]
    assert ("status", "approved") in kinds
