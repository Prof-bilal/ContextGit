"""Real Git regressions for parent-led teams, without launching any agent CLI."""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from contextgit.api.app import create_app
from contextgit.core.errors import InvalidTaskTransition, TaskNotReviewable
from contextgit.core.repo import Repo
from contextgit.gitops.repo import Git
from contextgit.llm.fake import FakeProvider
from contextgit.mcp import tools


def project(tmp_path):
    path = tmp_path / "project"
    path.mkdir()
    git = Git(path)
    git.run("init", "-b", "main")
    git.run("config", "user.email", "test@example.com")
    git.run("config", "user.name", "Test")
    (path / ".gitignore").write_text(".contextgit/\n")
    (path / "README.md").write_text("initial\n")
    git.run("add", ".")
    git.run("commit", "-m", "Initial")
    return path


def managed(repo, path, cap=4):
    team = repo.create_team("Parent-led", project_path=str(path), orchestrator_agent="codex", goal="Implement two independent files")
    repo.set_team_gate(team.id, f'"{sys.executable}" -c "print(123)"')
    repo.team_execution.configure(team.id, cap, ["codex", "claude"])
    return team


def plan(repo, team, dependent=True):
    repo.save_team_plan(team.id, {"tasks": [
        {"id": "one", "title": "One", "role": "implementer", "agent": "codex", "brief": "Implement one", "scope": ["one.txt"], "done_criteria": "One exists", "depends_on": []},
        {"id": "two", "title": "Two", "role": "implementer", "agent": "claude", "brief": "Implement two", "scope": ["two.txt"], "done_criteria": "Two exists", "depends_on": ["one"] if dependent else []},
    ]})
    repo.approve_team_plan(team.id)
    return repo.list_tasks(team.id)


def implement(repo, task, name, content="implemented\n"):
    session = repo.get_session(repo.get_task(task.id).session_id)
    path = Path(session.worktree_path)
    (path / name).write_text(content)
    git = Git(path)
    git.run("add", name)
    git.run("commit", "-m", f"Implement {name}")
    repo.complete_task(task.id)
    return session


def test_parent_prompt_and_worktree_are_ready_before_terminal_launch(repo, tmp_path):
    path = project(tmp_path)
    team = managed(repo, path)
    client = TestClient(create_app(repo=repo, provider=FakeProvider()))
    response = client.post(f"/api/v1/teams/{team.id}/orchestrator/start")
    assert response.status_code == 200, response.text
    parent = response.json()
    assert parent["worktree_path"] != str(path)
    assert Path(parent["worktree_path"]).is_dir()
    assert "propose_team_plan" in parent["task"]
    assert "Decide how many workers" in parent["task"]
    assert "Do not merge into main" in parent["task"]
    import json
    config = json.loads((Path(parent["worktree_path"]) / ".mcp.json").read_text())
    env = config["mcpServers"]["contextgit"]["env"]
    assert env["CONTEXTGIT_REPO"] == str(repo.root.resolve())
    assert env["CONTEXTGIT_ROLE"] == "orchestrator"
    assert env["CONTEXTGIT_TEAM"] == team.id
    assert not repo.list_tasks(team.id)
    assert client.post(f"/api/v1/teams/{team.id}/orchestrator/start").json()["id"] == parent["id"]


@pytest.mark.parametrize("agent", ["codex", "claude", "opencode", "commandcode"])
def test_all_parent_clis_persist_model_and_worker_defaults(repo, tmp_path, monkeypatch, agent):
    monkeypatch.setattr("contextgit.mcp.config.opencode_v2", lambda: True)
    path = project(tmp_path)
    client = TestClient(create_app(repo=repo, provider=FakeProvider()))
    result = client.post("/api/v1/teams", json={"name": "Team", "project_path": str(path), "goal": "Task",
        "managed_execution": True, "orchestrator_agent": agent, "orchestrator_model": "provider/test",
        "allowed_agents": ["codex", "claude", "opencode", "commandcode"], "worker_models": {"codex": "worker-test"}})
    assert result.status_code == 201, result.text
    team_id = result.json()["team"]["id"]
    parent = client.post(f"/api/v1/teams/{team_id}/orchestrator/start")
    assert parent.status_code == 200, parent.text
    assert parent.json()["agent"] == agent
    assert parent.json()["model"] == "provider/test"
    assert repo.team_execution.settings(team_id)["worker_models"]["codex"] == "worker-test"
    first, _ = plan(repo, repo.get_team(team_id))
    repo.launch_team(team_id)
    assert repo.get_session(repo.get_task(first.id).session_id).model == "worker-test"


def test_invalid_model_does_not_create_an_orphan_team(repo, tmp_path):
    path = project(tmp_path)
    client = TestClient(create_app(repo=repo, provider=FakeProvider()))
    response = client.post("/api/v1/teams", json={"name": "Invalid", "project_path": str(path),
        "managed_execution": True, "orchestrator_agent": "codex", "orchestrator_model": "--flag"})
    assert response.status_code == 422
    assert not repo.list_teams()


def test_review_integrates_before_dependencies_start_and_never_changes_main(repo, tmp_path):
    path = project(tmp_path)
    main = Git(path).rev_parse("main")
    team = managed(repo, path)
    first, second = plan(repo, team)
    repo.launch_team(team.id)
    assert repo.get_task(second.id).session_id is None
    implement(repo, first, "one.txt")
    repo.approve_task(first.id)
    execution = repo.team_execution.settings(team.id)
    integrated = Git(path).rev_parse(execution["integration_branch"])
    next_session = repo.get_session(repo.get_task(second.id).session_id)
    assert next_session.base_commit == integrated
    assert (Path(next_session.worktree_path) / "one.txt").read_text() == "implemented\n"
    assert Git(path).rev_parse("main") == main
    assert not (path / "one.txt").exists()
    implement(repo, second, "two.txt")
    repo.approve_task(second.id)
    before = Git(path).rev_parse(execution["integration_branch"])
    repo.team_execution.integrate(team.id)
    assert Git(path).rev_parse(execution["integration_branch"]) == before
    assert repo.team_execution.preview(team.id)["ready"]
    result = repo.team_execution.confirm(team.id)
    assert result["completed"]
    assert (path / "one.txt").exists() and (path / "two.txt").exists()


def test_cap_and_unapproved_workers_are_enforced(repo, tmp_path):
    path = project(tmp_path)
    team = managed(repo, path, cap=1)
    first, second = plan(repo, team, dependent=False)
    assert len(repo.launch_team(team.id)) == 1
    unapproved = repo.create_task(team.id, title="Sneak", role="implementer", agent="codex", scope=["third.txt"])
    with pytest.raises(InvalidTaskTransition, match="approve"):
        repo.start_task(unapproved.id)
    assert repo.get_task(second.id).session_id is None


def test_amendment_preserves_workers_and_requires_approval(repo, tmp_path):
    path = project(tmp_path)
    team = managed(repo, path)
    first, second = plan(repo, team)
    repo.launch_team(team.id)
    original_session = repo.get_task(first.id).session_id
    revised = repo.latest_team_plan(team.id).plan
    revised["tasks"].append({"id": "extra", "title": "Extra", "role": "reviewer", "agent": "codex", "brief": "Write docs", "scope": ["docs/**"], "done_criteria": "Docs match", "depends_on": []})
    repo.save_team_plan(team.id, revised)
    assert len(repo.list_tasks(team.id)) == 2
    with pytest.raises(InvalidTaskTransition, match="approve"):
        repo.start_task(second.id)
    repo.approve_team_plan(team.id)
    assert len(repo.list_tasks(team.id)) == 3
    assert repo.get_task(first.id).session_id == original_session
    assert repo.latest_team_plan(team.id).status == "approved"


def test_dirty_worker_and_failed_combined_checks_cannot_advance_branch(repo, tmp_path, monkeypatch):
    path = project(tmp_path)
    team = managed(repo, path)
    first, _ = plan(repo, team)
    repo.launch_team(team.id)
    session = implement(repo, first, "one.txt")
    branch = repo.team_execution.settings(team.id)["integration_branch"]
    original = Git(path).rev_parse(branch)
    (Path(session.worktree_path) / "one.txt").write_text("uncommitted\n")
    with pytest.raises(TaskNotReviewable, match="Commit"):
        repo.approve_task(first.id)
    assert Git(path).rev_parse(branch) == original
    git = Git(session.worktree_path)
    git.run("add", "one.txt")
    git.run("commit", "-m", "Commit correction")
    from contextgit.core import team_execution
    real_run = team_execution.run_command
    def fail_combined(command, cwd, **kwargs):
        return real_run('"' + sys.executable + '" -c "raise SystemExit(1)"', cwd, **kwargs) if "integration-" in str(cwd) else real_run(command, cwd, **kwargs)
    monkeypatch.setattr(team_execution, "run_command", fail_combined)
    with pytest.raises(TaskNotReviewable, match="Combined checks"):
        repo.team_execution.integrate(team.id)
    assert Git(path).rev_parse(branch) == original
    record = repo._storage.team_integrations(team.id)[0]
    assert record["status"] == "blocked" and Path(record["candidate_path"]).exists()
    monkeypatch.setattr(team_execution, "run_command", real_run)
    repo.team_execution.integrate(team.id)
    assert Git(path).rev_parse(branch) != original


def test_pause_and_parent_permission_guard(repo, tmp_path, monkeypatch):
    path = project(tmp_path)
    team = managed(repo, path)
    plan(repo, team)
    repo.update_team_details(team.id, state="paused")
    with pytest.raises(InvalidTaskTransition, match="Resume"):
        repo.team_execution.integrate(team.id)
    monkeypatch.setenv(tools.ROLE_ENV, "worker")
    monkeypatch.setenv(tools.TEAM_ENV, team.id)
    assert tools.integrate_team(repo)["type"] == "Forbidden"
    monkeypatch.setenv(tools.ROLE_ENV, "orchestrator")
    assert tools.integrate_team(repo, "other-team")["type"] == "Forbidden"


def test_real_merge_conflict_retains_candidate_and_never_advances_target(repo, tmp_path):
    path = project(tmp_path)
    (path / "one.txt").write_text("base\n")
    git = Git(path)
    git.run("add", "one.txt")
    git.run("commit", "-m", "Base file")
    team = managed(repo, path)
    first, _ = plan(repo, team)
    repo.launch_team(team.id)
    implement(repo, first, "one.txt", "worker change\n")
    branch = repo.team_execution.settings(team.id)["integration_branch"]
    alternate = tmp_path / "integration"
    git.run("worktree", "add", str(alternate), branch)
    (alternate / "one.txt").write_text("conflicting integration change\n")
    other = Git(alternate)
    other.run("add", "one.txt")
    other.run("commit", "-m", "Concurrent branch change")
    before = git.rev_parse(branch)
    with pytest.raises(TaskNotReviewable):
        repo.approve_task(first.id)
    assert git.rev_parse(branch) == before
    record = repo._storage.team_integrations(team.id)[0]
    assert record["status"] == "blocked"
    assert Git(record["candidate_path"]).run("ls-files", "-u").stdout
    assert (path / "one.txt").read_text() == "base\n"
    # The parent can reject an accepted-but-blocked result for correction.
    repo.reject_task(first.id, "Resolve the conflict before resubmitting")
    assert repo.get_task(first.id).status == "working"


def test_amendments_cannot_change_live_instructions_or_create_cycles(repo, tmp_path):
    path = project(tmp_path)
    team = managed(repo, path)
    first, _ = plan(repo, team)
    repo.launch_team(team.id)
    previous = repo.get_task(first.id)
    draft = repo.latest_team_plan(team.id).plan
    draft["tasks"][0]["scope"] = ["different/**"]
    repo.save_team_plan(team.id, draft)
    with pytest.raises(InvalidTaskTransition, match="unchanged"):
        repo.approve_team_plan(team.id)
    assert repo.get_task(first.id).scope == previous.scope
    assert repo.get_task(first.id).session_id == previous.session_id
