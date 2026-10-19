"""Regression tests for spatial plans, process scheduling and reviewed skill reuse."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from contextgit.api.app import create_app
from contextgit.core.errors import InvalidTaskTransition, TaskCycleError
from contextgit.core.repo import Repo
from contextgit.gitops.repo import Git
from contextgit.knowledge.skills import SkillDraft, SkillLibrary
from contextgit.llm.fake import FakeProvider
from contextgit.mcp import tools


def test_invalid_plan_is_atomic_and_does_not_mark_approved(repo: Repo, tmp_path: Path) -> None:
    team = repo.create_team("spatial", project_path=str(tmp_path))
    repo.save_team_plan(
        team.id,
        {
            "tasks": [
                {"id": "one", "depends_on": ["two"]},
                {"id": "two", "depends_on": ["one"]},
            ]
        },
    )
    with pytest.raises(TaskCycleError):
        repo.approve_team_plan(team.id)
    assert repo.list_tasks(team.id) == []
    assert repo.latest_team_plan(team.id).status == "draft"


def test_plan_refuses_unknown_dependencies_and_over_capacity(repo: Repo, tmp_path: Path) -> None:
    team = repo.create_team("spatial", project_path=str(tmp_path))
    repo.save_team_plan(team.id, {"tasks": [{"id": "one", "depends_on": ["absent"]}]})
    with pytest.raises(InvalidTaskTransition):
        repo.approve_team_plan(team.id)
    assert not repo.list_tasks(team.id)
    for i in range(12):
        repo.create_task(team.id, title=f"Worker {i}")
    with pytest.raises(InvalidTaskTransition, match="12"):
        repo.create_task(team.id, title="overflow")


def test_paused_team_reviews_without_launching_dependents(repo: Repo, tmp_path: Path) -> None:
    team = repo.create_team("spatial", project_path=str(tmp_path))
    first = repo.create_task(team.id, title="first", agent="shell")
    second = repo.create_task(team.id, title="second", agent="shell", depends_on=[first.id])
    repo.launch_team(team.id)
    repo.update_team_details(team.id, state="paused")
    repo.complete_task(first.id)
    repo.approve_task(first.id)
    assert repo.get_task(second.id).session_id is None
    repo.update_team_details(team.id, state="running")
    repo.launch_team(team.id)
    assert repo.get_task(second.id).session_id is not None


def test_orchestrator_requires_explicit_team_and_cannot_cross_teams(
    repo: Repo, tmp_path: Path, monkeypatch
) -> None:
    first = repo.create_team("first", project_path=str(tmp_path))
    second = repo.create_team("second", project_path=str(tmp_path))
    monkeypatch.setenv(tools.ROLE_ENV, "orchestrator")
    monkeypatch.delenv(tools.TEAM_ENV, raising=False)
    assert tools.pause_team(repo)["type"] == "Forbidden"
    monkeypatch.setenv(tools.TEAM_ENV, first.id)
    assert tools.pause_team(repo, second.id)["type"] == "Forbidden"
    assert tools.pause_team(repo)["id"] == first.id
    assert repo.get_team(second.id).state == "draft"


def test_review_promote_remove_preserves_snapshots(repo: Repo, tmp_path: Path) -> None:
    project = tmp_path / "project"
    project.mkdir()
    library = SkillLibrary(str(project), tmp_path / "global-skills")
    draft = library.propose(
        SkillDraft(
            title="Test first", instruction="Run the auth tests.", evidence="Reviewed task passed."
        )
    )
    folder = project / ".contextgit/knowledge/skills" / draft.id
    assert not (folder / "SKILL.md").exists()
    with pytest.raises(ValueError, match="approve"):
        library.review("project", draft.id, "promote")
    approved = library.review("project", draft.id, "approve")
    assert (folder / "SKILL.md").is_file()
    team = repo.create_team("test", project_path=str(project))
    link = repo.attach_skill(
        team.id, skill_id=approved.id, title=approved.title, instruction=approved.instruction
    )
    library.review("project", draft.id, "approve", "Run every test.")
    assert repo.team_skills(team.id)[0].instruction == link.instruction == "Run the auth tests."
    promoted = library.review("project", draft.id, "promote")
    assert promoted.origin == "global"
    assert (tmp_path / "global-skills" / promoted.id / "SKILL.md").is_file()
    library.review("project", draft.id, "remove")
    assert not (folder / "SKILL.md").exists()
    assert (folder / "revision-1.json").exists()
    other = SkillLibrary(str(tmp_path / "other-project"), tmp_path / "global-skills")
    assert [skill.id for skill in other.list()] == [promoted.id]


def test_unreviewed_skills_cannot_be_assigned(repo: Repo, tmp_path: Path) -> None:
    team = repo.create_team("test", project_path=str(tmp_path))
    library = SkillLibrary(str(tmp_path))
    skill = library.propose(SkillDraft(title="Unreviewed", instruction="Draft instruction"))
    with pytest.raises(InvalidTaskTransition, match="Approve"):
        repo.attach_skill(
            team.id, skill_id=skill.id, title=skill.title, instruction=skill.instruction
        )
    assert not repo.team_skills(team.id)


def test_spatial_completion_never_uses_automatic_integration(
    repo: Repo, tmp_path: Path, monkeypatch
) -> None:
    team = repo.create_team(
        "explicit merge", project_path=str(tmp_path), orchestrator_agent="shell"
    )
    repo.save_team_plan(team.id, {"tasks": [{"id": "work", "title": "Work", "agent": "shell"}]})
    repo.approve_team_plan(team.id)
    repo.launch_team(team.id)

    def unexpected(*args, **kwargs):
        pytest.fail("Spatial work must never enter the automatic integration coordinator")

    monkeypatch.setattr(repo.integration, "ready", unexpected)
    task = repo.list_tasks(team.id)[0]
    assert repo.complete_task(task.id).status == "review"


def test_existing_sessions_import_and_group_without_losing_identity(
    repo: Repo, tmp_path: Path
) -> None:
    session = repo.create_session(
        "legacy run", kind="terminal", agent="shell", project_path=str(tmp_path)
    )
    created = repo.import_ungrouped_sessions(str(tmp_path))
    assert len(created) == 1 and created[0].name == "Ungrouped runs"
    task = repo.list_tasks(created[0].id)[0]
    assert task.session_id == session.id
    assert repo.import_ungrouped_sessions(str(tmp_path)) == []
    group = repo.regroup_workers(str(tmp_path), "My group", [task.id])
    assert repo.get_task(task.id).team_id == group.id
    assert repo.get_task(task.id).session_id == session.id
    assert repo.get_session(session.id).branch == session.branch
    assert not repo.list_tasks(created[0].id)
    assert repo.latest_team_plan(group.id).status == "approved"
    assert repo.get_task(task.id).status == "todo"
    repo.launch_team(group.id)
    assert repo.get_task(task.id).status == "working"
    assert repo.get_task(task.id).session_id == session.id


def test_spatial_workers_cannot_bypass_plan_approval(repo: Repo, tmp_path: Path) -> None:
    team = repo.create_team(
        "needs approval", project_path=str(tmp_path), orchestrator_agent="shell"
    )
    task = repo.create_task(team.id, title="unapproved worker", agent="shell")
    with pytest.raises(InvalidTaskTransition, match="approve"):
        repo.start_task(task.id)
    assert repo.get_task(task.id).session_id is None


def test_goal_to_explicit_merge_and_global_skill(tmp_path: Path, monkeypatch) -> None:
    project = tmp_path / "app"
    project.mkdir()
    git = Git(project)
    git.run("init", "-q", "-b", "main")
    git.run("config", "user.name", "Tester")
    git.run("config", "user.email", "test@localhost")
    (project / "README.md").write_text("Example project\n")
    git.run("add", "README.md")
    git.run("commit", "-qm", "Initial")
    original_head = git.rev_parse("main")
    repo = Repo.init(project / ".contextgit")
    monkeypatch.setenv("CONTEXTGIT_ROOT", str(tmp_path / "app-data"))
    client = TestClient(create_app(repo=repo, provider=FakeProvider()))
    team = client.post(
        "/api/v1/teams",
        json={
            "name": "Delivery",
            "project_path": str(project),
            "goal": "Build two modules",
            "orchestrator_agent": "shell",
        },
    ).json()["team"]
    session = client.post(f"/api/v1/teams/{team['id']}/orchestrator/start").json()
    assert session["role"] == "orchestrator"
    monkeypatch.setenv(tools.ROLE_ENV, "orchestrator")
    monkeypatch.setenv(tools.TEAM_ENV, team["id"])
    proposed = tools.propose_team_plan(
        repo,
        "Build two modules",
        [
            {"id": "one", "title": "First module", "agent": "shell", "scope": ["one.py"]},
            {
                "id": "two",
                "title": "Second module",
                "agent": "shell",
                "scope": ["two.py"],
                "depends_on": ["one"],
            },
        ],
    )
    assert proposed["status"] == "draft"
    assert repo.list_tasks(team["id"]) == []
    assert client.post(f"/api/v1/teams/{team['id']}/merge/confirm").status_code == 409
    assert client.post(f"/api/v1/teams/{team['id']}/plan/approve").status_code == 200
    for index in range(2):
        task = repo.list_tasks(team["id"])[index]
        assert task.session_id
        worker = repo.get_session(task.session_id)
        worktree = Path(worker.worktree_path)
        (worktree / ("one.py" if index == 0 else "two.py")).write_text(f"VALUE = {index}\n")
        worker_git = Git(worktree)
        worker_git.run("add", "one.py" if index == 0 else "two.py")
        worker_git.run("commit", "-qm", "Implement module")
        assert (
            client.post(f"/api/v1/teams/{team['id']}/tasks/{task.id}/complete").status_code == 200
        )
        assert client.post(f"/api/v1/teams/{team['id']}/tasks/{task.id}/approve").status_code == 200
    assert git.rev_parse("main") == original_head
    preview = client.post(f"/api/v1/teams/{team['id']}/merge/preview").json()
    assert preview["ready"] and preview["requires_confirmation"]
    assert git.rev_parse("main") == original_head
    merged = client.post(f"/api/v1/teams/{team['id']}/merge/confirm")
    assert merged.status_code == 200 and all(
        entry["status"] == "merged" for entry in merged.json()["entries"]
    )
    assert git.rev_parse("main") != original_head
    assert git.run("show", "main:one.py").stdout == "VALUE = 0\n"
    assert git.run("show", "main:two.py").stdout == "VALUE = 1\n"
    draft = tools.propose_skill(
        repo,
        "Review modules",
        "Run module tests before completion.",
        "Both module tasks were reviewed.",
    )
    assert draft["status"] == "draft"
    params = {"project_path": str(project)}
    approved = client.post(
        f"/api/v1/skills/project/{draft['id']}/review", params=params, json={"action": "approve"}
    )
    assert approved.status_code == 200
    promoted = client.post(
        f"/api/v1/skills/project/{draft['id']}/review", params=params, json={"action": "promote"}
    ).json()
    assert (tmp_path / "app-data/skills" / promoted["id"] / "SKILL.md").exists()
