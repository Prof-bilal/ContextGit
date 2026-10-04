"""Team mode: the task graph, dependency gating, enforced claims, the board file."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from contextgit.core.errors import (
    InvalidRefName,
    ScopeConflict,
    TaskCycleError,
    TaskDependencyError,
    TaskNotFound,
)
from contextgit.core.models import Task, TaskStatus
from contextgit.core.repo import Repo
from contextgit.core.team import blocked_by, columns, topological_order, validate_graph


def _git(cwd: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, check=True
    ).stdout


@pytest.fixture
def project(tmp_path: Path) -> Path:
    root = tmp_path / "proj"
    root.mkdir()
    _git(root, "init", "-q", "-b", "main")
    _git(root, "config", "user.email", "t@example.com")
    _git(root, "config", "user.name", "Tester")
    (root / "app.py").write_text("print('hi')\n")
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "init")
    return root


@pytest.fixture
def team(repo: Repo, project: Path):  # noqa: ANN201 - Repo.create_team return type
    return repo.create_team("portal", project_path=str(project))


class TestTaskGraph:
    """Pure graph helpers — no storage, no git."""

    def _task(self, task_id: str, status: TaskStatus = "todo") -> Task:
        return Task(id=task_id, team_id="t", title=task_id, status=status)

    def test_topological_order_respects_edges(self) -> None:
        assert topological_order(["a", "b", "c"], {"b": ["a"], "c": ["b"]}) == ["a", "b", "c"]

    def test_topological_order_raises_on_cycle(self) -> None:
        with pytest.raises(TaskCycleError):
            topological_order(["a", "b"], {"a": ["b"], "b": ["a"]})

    def test_blocked_by_lists_unfinished_dependencies(self) -> None:
        tasks = {"a": self._task("a", "done"), "b": self._task("b", "working")}
        assert blocked_by("c", tasks, {"c": ["a"]}) == []
        assert blocked_by("c", tasks, {"c": ["b"]}) == ["b"]
        assert blocked_by("c", tasks, {"c": ["a", "b"]}) == ["b"]

    def test_validate_rejects_unknown_and_self_dependency(self) -> None:
        with pytest.raises(TaskCycleError):
            validate_graph(["a"], {"a": ["ghost"]})
        with pytest.raises(TaskCycleError):
            validate_graph(["a"], {"a": ["a"]})

    def test_columns_group_by_status(self) -> None:
        tasks = [self._task("a", "todo"), self._task("b", "done"), self._task("c", "blocked")]
        board = columns(tasks)
        assert [task.id for task in board["todo"]] == ["a"]
        assert [task.id for task in board["done"]] == ["b"]
        assert [task.id for task in board["blocked"]] == ["c"]


class TestTeamCrud:
    def test_create_team_resolves_the_base_branch(self, repo: Repo, project: Path) -> None:
        created = repo.create_team("portal", project_path=str(project))
        assert created.base_ref == "main"
        assert repo.current_team() == created

    def test_board_lists_tasks_and_messages(self, repo: Repo, team) -> None:  # noqa: ANN001
        repo.create_task(team.id, title="api", scope=["src/api/**"], role="backend")
        board = repo.team_board()
        assert board is not None
        assert [task.title for task in board.tasks] == ["api"]
        assert board.tasks[0].scope == ["src/api/**"]

    def test_contract_file_is_owned_by_the_task(self, repo: Repo, team) -> None:  # noqa: ANN001
        task = repo.create_task(
            team.id, title="api", scope=["src/api/**"], contract="openapi.yaml"
        )
        assert "openapi.yaml" in task.scope

    def test_dependencies_fill_blocked_by(self, repo: Repo, team) -> None:  # noqa: ANN001
        first = repo.create_task(team.id, title="api")
        second = repo.create_task(team.id, title="web", depends_on=[first.id])
        assert second.depends_on == [first.id]
        assert second.blocked_by == [first.id]
        repo.approve_task(first.id)
        assert repo.get_task(second.id).blocked_by == []

    def test_cycle_is_rejected_and_graph_unchanged(self, repo: Repo, team) -> None:  # noqa: ANN001
        first = repo.create_task(team.id, title="a")
        second = repo.create_task(team.id, title="b", depends_on=[first.id])
        with pytest.raises(TaskCycleError):
            repo.set_task_deps(first.id, [second.id])
        assert repo.get_task(first.id).depends_on == []

    def test_unknown_dependency_is_rejected(self, repo: Repo, team) -> None:  # noqa: ANN001
        with pytest.raises(TaskNotFound):
            repo.create_task(team.id, title="b", depends_on=["does-not-exist"])

    def test_deleting_a_task_clears_it_from_the_board(self, repo: Repo, team) -> None:  # noqa: ANN001
        task = repo.create_task(team.id, title="api")
        repo.delete_task(task.id)
        assert repo.list_tasks(team.id) == []


class TestLaunchAndGating:
    def test_launch_starts_only_ready_tasks(self, repo: Repo, team) -> None:  # noqa: ANN001
        api = repo.create_task(team.id, title="api", agent="shell", scope=["src/api/**"])
        web = repo.create_task(team.id, title="web", agent="shell", depends_on=[api.id])

        started = repo.launch_team()

        assert [task.title for task in started] == ["api"]
        assert repo.get_task(api.id).status == "working"
        # The dependent is blocked, not started: no session, no worktree.
        blocked = repo.get_task(web.id)
        assert blocked.status == "blocked"
        assert blocked.session_id is None
        # The ready run really got its own worktree.
        session = repo.get_session(str(repo.get_task(api.id).session_id))
        assert session.worktree_path is not None
        assert Path(session.worktree_path).exists()

    def test_approve_unblocks_and_starts_the_dependent(self, repo: Repo, team) -> None:  # noqa: ANN001
        api = repo.create_task(team.id, title="api", agent="shell", scope=["src/api/**"])
        web = repo.create_task(team.id, title="web", agent="shell", depends_on=[api.id])
        repo.launch_team()

        repo.complete_task(api.id)
        # Completion now stops at review; approval is what finishes the task.
        assert repo.get_task(api.id).status == "review"

        repo.approve_task(api.id)

        assert repo.get_task(api.id).status == "done"
        dependent = repo.get_task(web.id)
        assert dependent.status == "working"
        assert dependent.session_id is not None
        # The handoff is on the board so the next agent can read it.
        kinds = [message.kind for message in repo.team_messages(team.id)]
        assert "review" in kinds

    def test_start_refuses_a_blocked_task(self, repo: Repo, team) -> None:  # noqa: ANN001
        api = repo.create_task(team.id, title="api")
        web = repo.create_task(team.id, title="web", depends_on=[api.id])
        with pytest.raises(TaskDependencyError):
            repo.start_task(web.id)

    def test_launch_records_a_system_message(self, repo: Repo, team) -> None:  # noqa: ANN001
        repo.create_task(team.id, title="api", agent="shell")
        repo.launch_team()
        assert any(message.kind == "system" for message in repo.team_messages(team.id))


class TestEnforcedClaims:
    def test_overlapping_tasks_cannot_both_launch(self, repo: Repo, team) -> None:  # noqa: ANN001
        repo.create_task(team.id, title="a", scope=["src/api/**"])
        repo.create_task(team.id, title="b", scope=["src/api/users.py"])

        with pytest.raises(ScopeConflict):
            repo.launch_team()

        # Nothing was half-launched.
        assert all(task.session_id is None for task in repo.list_tasks(team.id))
        assert repo.fleet() == []

    def test_disjoint_tasks_both_launch(self, repo: Repo, team) -> None:  # noqa: ANN001
        repo.create_task(team.id, title="api", scope=["src/api/**"])
        repo.create_task(team.id, title="web", scope=["src/web/**"])
        assert len(repo.launch_team()) == 2
        assert len(repo.fleet()) == 2

    def test_single_mode_claims_stay_advisory(self, repo: Repo, project: Path) -> None:
        """Two overlapping Single-mode runs are allowed; only team mode blocks."""
        repo.create_session("a", project_path=str(project), worktree=True, scope=["src/api/**"])
        repo.create_session("b", project_path=str(project), worktree=True, scope=["src/api/**"])
        assert len(repo.list_sessions()) == 2


class TestBoardFile:
    def test_writes_team_md_and_the_managed_block(self, repo: Repo, project: Path, team) -> None:  # noqa: ANN001
        repo.create_task(team.id, title="api contract", role="backend", scope=["src/api/**"])

        board_file = project / ".contextgit" / "team.md"
        assert board_file.exists()
        text = board_file.read_text()
        assert "portal" in text
        assert "api contract" in text
        assert "src/api/**" in text

        agents = (project / "AGENTS.md").read_text()
        assert "<!-- contextgit:team:begin -->" in agents
        assert "api contract" in agents

    def test_board_rewrite_is_idempotent(self, repo: Repo, project: Path, team) -> None:  # noqa: ANN001
        repo.create_task(team.id, title="api")
        repo.sync_team_board(team.id)
        repo.sync_team_board(team.id)
        agents = (project / "AGENTS.md").read_text()
        assert agents.count("<!-- contextgit:team:begin -->") == 1

    def test_completed_work_shows_as_done_on_the_board(self, repo: Repo, project: Path, team) -> None:  # noqa: ANN001
        task = repo.create_task(team.id, title="api")
        repo.launch_team()
        repo.complete_task(task.id)
        assert "### Review" in (project / ".contextgit" / "team.md").read_text()
        repo.approve_task(task.id)
        assert "### Done" in (project / ".contextgit" / "team.md").read_text()


class TestMessages:
    def test_kind_is_validated(self, repo: Repo, team) -> None:  # noqa: ANN001
        with pytest.raises(InvalidRefName):
            repo.post_message(team.id, "hello", kind="shout")

    def test_messages_keep_their_order(self, repo: Repo, team) -> None:  # noqa: ANN001
        repo.post_message(team.id, "first")
        repo.post_message(team.id, "second", kind="question")
        assert [message.body for message in repo.team_messages(team.id)] == ["first", "second"]


class TestTeamMerge:
    def test_only_done_tasks_are_queued_in_order(self, repo: Repo, team) -> None:  # noqa: ANN001
        api = repo.create_task(team.id, title="api", agent="shell", scope=["src/api/**"])
        web = repo.create_task(team.id, title="web", agent="shell", scope=["src/web/**"])
        repo.launch_team()

        assert repo.queue_done_tasks() == []  # nothing is done yet

        repo.complete_task(api.id)
        assert repo.queue_done_tasks() == []  # in review, not done
        repo.approve_task(api.id)

        entries = repo.queue_done_tasks()
        assert len(entries) == 1
        assert entries[0].session_id == repo.get_task(api.id).session_id
        assert repo.get_task(web.id).status == "working"
