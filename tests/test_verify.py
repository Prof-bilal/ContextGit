"""The quality gate, the review verdict, run isolation and the WIP cap."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from contextgit.core.errors import (
    GateNotConfigured,
    TaskDependencyError,
    TaskNotReviewable,
    WorkInProgressLimit,
)
from contextgit.core.repo import Repo
from contextgit.verify import detect_gate, run_command


def _git(cwd: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, check=True
    ).stdout


def _project(tmp_path: Path, name: str = "proj") -> Path:
    root = tmp_path / name
    root.mkdir()
    _git(root, "init", "-q", "-b", "main")
    _git(root, "config", "user.email", "t@example.com")
    _git(root, "config", "user.name", "Tester")
    (root / "app.py").write_text("print('hi')\n")
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "init")
    return root


@pytest.fixture
def project(tmp_path: Path) -> Path:
    return _project(tmp_path)


@pytest.fixture
def team(repo: Repo, project: Path):  # noqa: ANN201 - Repo.create_team return type
    return repo.create_team("portal", project_path=str(project))


class TestDetect:
    def test_package_json_prefers_the_test_script(self, tmp_path: Path) -> None:
        root = tmp_path / "node"
        root.mkdir()
        (root / "package.json").write_text(json.dumps({"scripts": {"lint": "eslint ."}}))
        assert detect_gate(root) == "npm run lint"
        (root / "package.json").write_text(
            json.dumps({"scripts": {"test": "vitest", "lint": "eslint ."}})
        )
        assert detect_gate(root) == "npm test"

    def test_makefile_test_target(self, tmp_path: Path) -> None:
        root = tmp_path / "mk"
        root.mkdir()
        (root / "Makefile").write_text("build:\n\techo hi\ntest:\n\tpytest\n")
        assert detect_gate(root) == "make test"

    def test_python_project_from_tests_dir(self, tmp_path: Path) -> None:
        root = tmp_path / "py"
        (root / "tests").mkdir(parents=True)
        assert detect_gate(root) == "python -m pytest -q"

    def test_pyproject_pytest_config(self, tmp_path: Path) -> None:
        root = tmp_path / "toml"
        root.mkdir()
        (root / "pyproject.toml").write_text("[tool.pytest.ini_options]\naddopts = '-q'\n")
        assert detect_gate(root) == "python -m pytest -q"

    def test_nothing_declared_is_none(self, tmp_path: Path) -> None:
        root = tmp_path / "empty"
        root.mkdir()
        assert detect_gate(root) is None
        assert detect_gate(tmp_path / "missing") is None


class TestRunner:
    def test_success_captures_output(self, tmp_path: Path) -> None:
        result = run_command("echo gate-ran", tmp_path)
        assert result.ok is True
        assert result.exit_code == 0
        assert "gate-ran" in result.output

    def test_failure_is_data_not_an_exception(self, tmp_path: Path) -> None:
        result = run_command("echo broken && exit 3", tmp_path)
        assert result.ok is False
        assert result.exit_code == 3
        assert "broken" in result.output

    def test_missing_binary_is_reported(self, tmp_path: Path) -> None:
        result = run_command("definitely-not-a-command-xyz", tmp_path)
        assert result.ok is False
        assert result.exit_code != 0

    def test_timeout_is_reported(self, tmp_path: Path) -> None:
        result = run_command("sleep 5", tmp_path, timeout=0.2)
        assert result.ok is False
        assert result.timed_out is True
        assert result.exit_code == 124


class TestGateFlow:
    def test_complete_without_a_gate_waits_for_review(self, repo: Repo, team) -> None:  # noqa: ANN001
        task = repo.create_task(team.id, title="api")
        repo.launch_team()
        assert repo.complete_task(task.id).status == "review"

    def test_passing_gate_lands_in_review(self, repo: Repo, team) -> None:  # noqa: ANN001
        task = repo.create_task(team.id, title="api", gate_command="echo all-green")
        repo.launch_team()

        done = repo.complete_task(task.id)

        assert done.status == "review"
        assert done.gate_status == "pass"
        assert done.gate_exit_code == 0
        assert "all-green" in str(done.gate_output)
        assert done.gate_ran_at is not None

    def test_failing_gate_sends_it_back_to_work(self, repo: Repo, team) -> None:  # noqa: ANN001
        task = repo.create_task(team.id, title="api", gate_command="echo nope && exit 2")
        repo.launch_team()

        gated = repo.complete_task(task.id)

        assert gated.status == "working"
        assert gated.gate_status == "fail"
        assert gated.gate_exit_code == 2
        assert "nope" in str(gated.gate_output)
        # The failure is on the board so the run can read it.
        kinds = [message.kind for message in repo.team_messages(team.id)]
        assert "gate" in kinds

    def test_gate_can_be_run_on_demand(self, repo: Repo, team) -> None:  # noqa: ANN001
        task = repo.create_task(team.id, title="api", gate_command="echo on-demand")
        repo.launch_team()
        gated = repo.run_task_gate(task.id)
        assert gated.gate_status == "pass"
        assert "on-demand" in str(gated.gate_output)

    def test_gate_needs_a_run(self, repo: Repo, team) -> None:  # noqa: ANN001
        task = repo.create_task(team.id, title="api", gate_command="echo hi")
        with pytest.raises(TaskDependencyError):
            repo.run_task_gate(task.id)

    def test_no_gate_anywhere_raises(self, repo: Repo, tmp_path: Path) -> None:
        plain = tmp_path / "plain"
        plain.mkdir()
        _git(plain, "init", "-q", "-b", "main")
        _git(plain, "config", "user.email", "t@example.com")
        _git(plain, "config", "user.name", "T")
        (plain / "a.txt").write_text("x\n")
        _git(plain, "add", "-A")
        _git(plain, "commit", "-q", "-m", "init")
        bare = repo.create_team("bare", project_path=str(plain))
        task = repo.create_task(bare.id, title="api")
        repo.launch_team()
        with pytest.raises(GateNotConfigured):
            repo.run_task_gate(task.id)

    def test_team_default_is_used_when_the_task_has_none(self, repo: Repo, team) -> None:  # noqa: ANN001
        repo.set_team_gate(team.id, "echo from-team")
        task = repo.create_task(team.id, title="api")
        repo.launch_team()
        assert "from-team" in str(repo.complete_task(task.id).gate_output)

    def test_create_team_detects_a_gate(self, repo: Repo, project: Path, tmp_path: Path) -> None:
        (project / "package.json").write_text(json.dumps({"scripts": {"test": "vitest"}}))
        team = repo.create_team("detected", project_path=str(project))
        assert team.gate_command == "npm test"


class TestReviewVerdict:
    def test_reject_sends_it_back_with_the_note(self, repo: Repo, team) -> None:  # noqa: ANN001
        task = repo.create_task(team.id, title="api")
        repo.launch_team()
        repo.complete_task(task.id)

        rejected = repo.reject_task(task.id, "add the cancelled-tier test")

        assert rejected.status == "working"
        assert rejected.review_note == "add the cancelled-tier test"
        bodies = [message.body for message in repo.team_messages(team.id)]
        assert any("cancelled-tier" in body for body in bodies)

    def test_done_task_cannot_be_reviewed_again(self, repo: Repo, team) -> None:  # noqa: ANN001
        task = repo.create_task(team.id, title="api")
        repo.launch_team()
        repo.complete_task(task.id)
        repo.approve_task(task.id)
        with pytest.raises(TaskNotReviewable):
            repo.approve_task(task.id)
        with pytest.raises(TaskNotReviewable):
            repo.reject_task(task.id, "too late")


class TestVerifierRun:
    def test_verifier_gets_its_own_read_only_run(self, repo: Repo, team) -> None:  # noqa: ANN001
        task = repo.create_task(team.id, title="api", agent="claude", scope=["src/api/**"])
        repo.launch_team()

        verified = repo.verify_task(task.id)

        assert verified.verifier_session_id is not None
        verifier = repo.get_session(str(verified.verifier_session_id))
        implementer = repo.get_session(str(verified.session_id))
        # A different agent, its own worktree branched from the implementer's, no claims.
        assert verifier.agent != implementer.agent
        assert verifier.worktree_path is not None
        assert verifier.base_ref == implementer.git_branch
        assert verifier.scope == []
        assert verifier.id != implementer.id

    def test_asking_twice_keeps_the_same_verifier(self, repo: Repo, team) -> None:  # noqa: ANN001
        task = repo.create_task(team.id, title="api", agent="claude")
        repo.launch_team()
        first = repo.verify_task(task.id)
        second = repo.verify_task(task.id)
        assert first.verifier_session_id == second.verifier_session_id
        assert len(repo.list_sessions()) == 2  # implementer + one verifier

    def test_verifier_agent_can_be_named(self, repo: Repo, team) -> None:  # noqa: ANN001
        task = repo.create_task(team.id, title="api", agent="claude")
        repo.launch_team()
        verified = repo.verify_task(task.id, agent="gemini")
        assert repo.get_session(str(verified.verifier_session_id)).agent == "gemini"

    def test_a_new_harness_is_verifier_eligible(self, repo: Repo, team) -> None:  # noqa: ANN001
        # One of the auto-installed harnesses can implement and be reviewed by a
        # different agent from the verifier preference list.
        task = repo.create_task(team.id, title="api", agent="cline")
        repo.launch_team()
        verified = repo.verify_task(task.id)
        verifier = repo.get_session(str(verified.verifier_session_id))
        assert verifier.agent is not None
        assert verifier.agent != "cline"


class TestIsolationAndLimits:
    def test_every_run_gets_a_unique_port(self, repo: Repo, project: Path) -> None:
        first = repo.create_session("a", project_path=str(project), worktree=True)
        second = repo.create_session("b", project_path=str(project), worktree=True)
        assert first.port is not None and second.port is not None
        assert first.port != second.port
        assert second.port > first.port

    def test_shared_workspace_run_has_no_port(self, repo: Repo, tmp_path: Path) -> None:
        plain = tmp_path / "plain-port"
        plain.mkdir()
        session = repo.create_session("plain", project_path=str(plain), worktree=True)
        assert session.port is None

    def test_wip_cap_stops_a_launch(
        self, repo: Repo, team, monkeypatch: pytest.MonkeyPatch  # noqa: ANN001
    ) -> None:
        monkeypatch.setenv("CONTEXTGIT_MAX_ACTIVE", "1")
        first = repo.create_task(team.id, title="a", scope=["src/a/**"])
        second = repo.create_task(team.id, title="b", scope=["src/b/**"])

        started = repo.launch_team()

        assert [task.title for task in started] == ["a"]
        assert repo.get_task(first.id).status == "working"
        assert repo.get_task(second.id).status == "todo"

    def test_starting_past_the_cap_raises(
        self, repo: Repo, team, monkeypatch: pytest.MonkeyPatch  # noqa: ANN001
    ) -> None:
        monkeypatch.setenv("CONTEXTGIT_MAX_ACTIVE", "1")
        first = repo.create_task(team.id, title="a", scope=["src/a/**"])
        second = repo.create_task(team.id, title="b", scope=["src/b/**"])
        repo.start_task(first.id)
        with pytest.raises(WorkInProgressLimit):
            repo.start_task(second.id)

    def test_task_tokens_count_committed_context(self, repo: Repo, team) -> None:  # noqa: ANN001
        from contextgit.core.models import Message

        task = repo.create_task(team.id, title="api")
        repo.launch_team()
        repo.stage(str(repo.get_task(task.id).session_id), [Message(role="tool", content="x" * 40)])
        assert repo.get_task(task.id).tokens > 0

    def test_tokens_are_zero_without_a_run(self, repo: Repo, team) -> None:  # noqa: ANN001
        task = repo.create_task(team.id, title="api")
        assert repo.get_task(task.id).tokens == 0
