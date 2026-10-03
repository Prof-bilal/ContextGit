"""Git worktree isolation: create/inspect/remove, changed files, pre-flight."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from contextgit.core.errors import InvalidRefName, RepoNotFound
from contextgit.core.models import Message, Session
from contextgit.core.repo import Repo
from contextgit.gitops import (
    DirtyWorktree,
    Git,
    NotAGitRepo,
    WorktreeExists,
    WorktreeManager,
    WorktreeNotFound,
    preflight,
)
from contextgit.gitops.globs import globs_overlap
from contextgit.storage.sqlite import SqliteStorage


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


class TestGit:
    def test_is_repo_true_and_false(self, project: Path, tmp_path: Path) -> None:
        assert Git(project).is_repo() is True
        assert Git(tmp_path).is_repo() is False

    def test_top_level_and_rev_parse(self, project: Path) -> None:
        assert Git(project).top_level() == project.resolve()
        assert len(Git(project).rev_parse("HEAD")) == 40

    def test_not_a_repo_raises(self, tmp_path: Path) -> None:
        with pytest.raises(NotAGitRepo):
            Git(tmp_path).top_level()


class TestWorktreeManager:
    def test_create_gives_isolated_checkout(self, project: Path) -> None:
        manager = WorktreeManager(project)
        alpha = manager.create("alpha")
        beta = manager.create("beta")
        assert alpha.exists() and beta.exists()
        (alpha / "app.py").write_text("alpha\n")
        assert (beta / "app.py").read_text() == "print('hi')\n"
        assert (project / "app.py").read_text() == "print('hi')\n"

    def test_create_ignores_contextgit_dir(self, project: Path) -> None:
        manager = WorktreeManager(project)
        manager.create("one")
        assert ".contextgit/" in (project / ".gitignore").read_text()
        assert ".contextgit" not in Git(project).changed_files("HEAD")

    def test_create_twice_raises(self, project: Path) -> None:
        manager = WorktreeManager(project)
        manager.create("dup")
        with pytest.raises(WorktreeExists):
            manager.create("dup")

    def test_invalid_name_raises(self, project: Path) -> None:
        with pytest.raises(ValueError):
            WorktreeManager(project).path_for("../escape")

    def test_list_reports_main_and_created(self, project: Path) -> None:
        manager = WorktreeManager(project)
        manager.create("one")
        infos = manager.list()
        paths = {info.path.resolve() for info in infos}
        assert project.resolve() in paths
        assert (manager.root / "one").resolve() in paths
        assert "ctx/one" in {info.branch for info in infos}

    def test_changed_files_reports_edits(self, project: Path) -> None:
        manager = WorktreeManager(project)
        worktree = manager.create("editor")
        (worktree / "app.py").write_text("print('changed')\n")
        (worktree / "new.txt").write_text("new\n")
        assert set(manager.changed_files("editor", "HEAD")) == {"app.py", "new.txt"}

    def test_remove_cleans_up_but_guards_dirty(self, project: Path) -> None:
        manager = WorktreeManager(project)
        worktree = manager.create("temp")
        (worktree / "app.py").write_text("dirty\n")
        with pytest.raises(DirtyWorktree):
            manager.remove("temp")
        manager.remove("temp", force=True)
        assert not worktree.exists()
        with pytest.raises(WorktreeNotFound):
            manager.remove("temp")

    def test_not_a_repo_raises(self, tmp_path: Path) -> None:
        with pytest.raises(NotAGitRepo):
            WorktreeManager(tmp_path).create("x")

    def test_available_flag(self, project: Path, tmp_path: Path) -> None:
        assert WorktreeManager(project).available is True
        assert WorktreeManager(tmp_path).available is False


class TestPreflight:
    def test_disjoint_new_files_are_clean(self, project: Path) -> None:
        manager = WorktreeManager(project)
        alpha = manager.create("alpha")
        beta = manager.create("beta")
        (alpha / "one.txt").write_text("one\n")
        (beta / "two.txt").write_text("two\n")
        _git(alpha, "add", "-A")
        _git(alpha, "commit", "-qm", "alpha")
        _git(beta, "add", "-A")
        _git(beta, "commit", "-qm", "beta")
        assert preflight(project, "ctx/alpha", "ctx/beta").clean is True

    def test_same_lines_conflict(self, project: Path) -> None:
        manager = WorktreeManager(project)
        alpha = manager.create("alpha")
        beta = manager.create("beta")
        (alpha / "app.py").write_text("A\n")
        (beta / "app.py").write_text("B\n")
        _git(alpha, "commit", "-qam", "alpha")
        _git(beta, "commit", "-qam", "beta")
        result = preflight(project, "ctx/alpha", "ctx/beta")
        assert result.clean is False
        assert "app.py" in result.conflicted_files


class TestSessionWorktreePairing:
    def test_create_session_pairs_branch_with_worktree(self, repo: Repo, project: Path) -> None:
        session = repo.create_session(
            "feature a", kind="terminal", project_path=str(project), worktree=True, task="draw a"
        )
        assert session.worktree_path is not None
        assert Path(session.worktree_path).exists()
        assert session.git_branch == f"ctx/{session.branch}"
        assert session.base_commit is not None
        assert session.task == "draw a"
        assert repo.get_session(session.id).worktree_path == session.worktree_path

    def test_delete_session_removes_clean_worktree(self, repo: Repo, project: Path) -> None:
        session = repo.create_session("temp", project_path=str(project), worktree=True)
        path = Path(str(session.worktree_path))
        repo.delete_session(session.id)
        assert not path.exists()

    def test_delete_keeps_dirty_worktree(self, repo: Repo, project: Path) -> None:
        session = repo.create_session("busy", project_path=str(project), worktree=True)
        path = Path(str(session.worktree_path))
        (path / "app.py").write_text("dirty\n")
        repo.delete_session(session.id)
        assert path.exists()

    def test_non_git_project_shares_workspace(self, repo: Repo, tmp_path: Path) -> None:
        plain = tmp_path / "plain"
        plain.mkdir()
        session = repo.create_session("plain", project_path=str(plain), worktree=True)
        assert session.worktree_path is None


class TestFleetStatus:
    def test_workspace_status_reports_changes(self, repo: Repo, project: Path) -> None:
        session = repo.create_session("alpha", project_path=str(project), worktree=True)
        (Path(str(session.worktree_path)) / "app.py").write_text("changed\n")
        status = repo.session_workspace(session.id)
        assert status.changed_files == ["app.py"]
        assert status.git_branch == f"ctx/{session.branch}"
        assert status.target == "main"
        assert status.clean is True

    def test_fleet_flags_overlapping_runs(self, repo: Repo, project: Path) -> None:
        alpha = repo.create_session("alpha", project_path=str(project), worktree=True)
        beta = repo.create_session("beta", project_path=str(project), worktree=True)
        (Path(str(alpha.worktree_path)) / "app.py").write_text("a\n")
        (Path(str(beta.worktree_path)) / "app.py").write_text("b\n")
        fleet = {entry.name: entry for entry in repo.fleet()}
        assert "app.py" in fleet["alpha"].changed_files
        assert beta.id in fleet["alpha"].overlaps
        assert alpha.id in fleet["beta"].overlaps

    def test_shared_workspace_run_has_empty_status(self, repo: Repo, tmp_path: Path) -> None:
        plain = tmp_path / "plain2"
        plain.mkdir()
        session = repo.create_session("plain", project_path=str(plain), worktree=True)
        status = repo.session_workspace(session.id)
        assert status.worktree_path is None
        assert status.changed_files == []


class TestRepoInitRecovery:
    """A database with tables but no HEAD must not be served as a live repo."""

    def test_open_rejects_uninitialized_db(self, tmp_path: Path) -> None:
        root = tmp_path / "half"
        root.mkdir()
        SqliteStorage(root / "contextgit.db").close()
        with pytest.raises(RepoNotFound):
            Repo.open(root)

    def test_init_recovers_uninitialized_db(self, tmp_path: Path) -> None:
        root = tmp_path / "half2"
        root.mkdir()
        SqliteStorage(root / "contextgit.db").close()
        recovered = Repo.init(root)
        assert recovered.current_branch() == "main"
        assert len(recovered.log("main")) == 1


class TestGlobs:
    def test_nesting_and_exact_overlap(self) -> None:
        assert globs_overlap("src/**", "src/api/users.py")
        assert globs_overlap("src/api/users.py", "src/**")
        assert globs_overlap("README.md", "README.md")
        assert not globs_overlap("src/api/**", "src/ui/**")


class TestClaims:
    def test_create_session_records_scope(self, repo: Repo, project: Path) -> None:
        session = repo.create_session(
            "api work", project_path=str(project), worktree=True, scope=["src/api/**"]
        )
        assert repo.session_claims(session.id) == ["src/api/**"]

    def test_conflicts_detect_nested_overlap(self, repo: Repo, project: Path) -> None:
        first = repo.create_session("a", project_path=str(project), worktree=True, scope=["src/api/**"])
        second = repo.create_session(
            "b", project_path=str(project), worktree=True, scope=["src/api/users.py"]
        )
        assert second.id in repo.claim_conflicts(["src/api/**"], exclude_session_id=first.id)
        assert repo.claim_conflicts(["docs/**"], exclude_session_id=first.id) == []

    def test_claim_replaces_previous(self, repo: Repo, project: Path) -> None:
        session = repo.create_session(
            "s", project_path=str(project), worktree=True, scope=["src/api/**"]
        )
        repo.claim(session.id, ["src/ui/**"])
        assert repo.session_claims(session.id) == ["src/ui/**"]
        assert repo.claim_conflicts(["src/api/**"], exclude_session_id=session.id) == []


class TestAgentContext:
    def test_sync_writes_managed_block(self, repo: Repo, project: Path) -> None:
        repo.create_session(
            "api",
            project_path=str(project),
            worktree=True,
            scope=["src/api/**"],
            agent="claude",
        )
        text = (project / "AGENTS.md").read_text()
        assert "<!-- contextgit:begin -->" in text
        assert "src/api/**" in text
        assert (project / ".contextgit" / "context.md").exists()

    def test_sync_is_idempotent(self, repo: Repo, project: Path) -> None:
        repo.create_session("one", project_path=str(project), worktree=True, scope=["src/**"])
        repo.sync_agent_context(str(project))
        repo.sync_agent_context(str(project))
        assert (project / "AGENTS.md").read_text().count("<!-- contextgit:begin -->") == 1


def _commit_file(worktree: Path, name: str, text: str, message: str) -> None:
    (worktree / name).write_text(text)
    _git(worktree, "add", "-A")
    _git(worktree, "commit", "-qm", message)


class TestMergeQueue:
    def test_two_runs_merge_in_order(self, repo: Repo, project: Path) -> None:
        alpha = repo.create_session("alpha", project_path=str(project), worktree=True)
        beta = repo.create_session("beta", project_path=str(project), worktree=True)
        _commit_file(Path(str(alpha.worktree_path)), "alpha.txt", "a\n", "alpha")
        _commit_file(Path(str(beta.worktree_path)), "beta.txt", "b\n", "beta")

        repo.enqueue_merge(alpha.id, "main")
        repo.enqueue_merge(beta.id, "main")
        results = repo.run_merge_queue("main")

        assert [entry.status for entry in results] == ["merged", "merged"]
        assert _git(project, "show", "main:alpha.txt") == "a\n"
        assert _git(project, "show", "main:beta.txt") == "b\n"
        # The target head is a real two-parent merge commit.
        assert len(_git(project, "rev-list", "--parents", "-1", "main").split()) == 3
        assert all(entry.status == "merged" for entry in repo.merge_queue())

    def test_conflicting_run_blocks_the_queue(self, repo: Repo, project: Path) -> None:
        alpha = repo.create_session("alpha", project_path=str(project), worktree=True)
        beta = repo.create_session("beta", project_path=str(project), worktree=True)
        _commit_file(Path(str(alpha.worktree_path)), "app.py", "A\n", "alpha")
        _commit_file(Path(str(beta.worktree_path)), "app.py", "B\n", "beta")

        repo.enqueue_merge(alpha.id, "main")
        repo.enqueue_merge(beta.id, "main")
        results = repo.run_merge_queue("main")

        assert results[0].status == "merged"
        assert results[1].status == "blocked"
        assert "app.py" in results[1].conflicts
        assert _git(project, "show", "main:app.py") == "A\n"

    def test_dequeue_removes_entry(self, repo: Repo, project: Path) -> None:
        session = repo.create_session("s", project_path=str(project), worktree=True)
        entry = repo.enqueue_merge(session.id, "main")
        repo.dequeue_merge(entry.id)
        assert repo.merge_queue() == []

    def test_enqueue_without_worktree_raises(self, repo: Repo, tmp_path: Path) -> None:
        plain = tmp_path / "plainmq"
        plain.mkdir()
        session = repo.create_session("plain", project_path=str(plain), worktree=True)
        with pytest.raises(InvalidRefName):
            repo.enqueue_merge(session.id, "main")


class _StubProvider:
    """Minimal LLMProvider returning a fixed JSON extraction."""

    def __init__(self, payload: dict[str, object]) -> None:
        self.payload = payload

    def complete(self, messages: list[Message], **opts: object) -> str:
        return json.dumps(self.payload)

    def stream(self, messages: list[Message], **opts: object) -> object:
        return iter([self.complete(messages)])

    def count_tokens(self, messages: list[Message]) -> int:
        return sum(len(message.content) for message in messages) // 4


class TestContextPairing:
    def _run_with_work(self, repo: Repo, project: Path, name: str) -> Session:
        session = repo.create_session(name, project_path=str(project), worktree=True)
        repo.stage(session.id, [Message(role="user", content=f"{name} decided X")])
        repo.commit_staged(session.id)
        _commit_file(Path(str(session.worktree_path)), f"{name}.txt", "x\n", name)
        return session

    def test_integrate_merges_code_and_context(self, repo: Repo, project: Path) -> None:
        session = self._run_with_work(repo, project, "alpha")
        head_before = repo.get_branch("main").head_commit_id
        source_head = repo.get_branch(session.branch).head_commit_id

        result = repo.integrate_run(session.id, target="main", git_target="main")

        assert _git(project, "show", "main:alpha.txt") == "x\n"
        assert result.code_commit_id == _git(project, "rev-parse", "main").strip()
        context_commit = repo.get_commit(result.context_commit_id)
        assert context_commit.parent_ids == [head_before, source_head]
        assert repo.get_branch("main").head_commit_id == result.context_commit_id

    def test_shared_context_digests_other_runs(self, repo: Repo, project: Path) -> None:
        self._run_with_work(repo, project, "alpha")
        second = repo.create_session("beta", project_path=str(project), worktree=True)
        text = repo.shared_context(second.id)
        assert "alpha" in text
        assert "decided X" in text

    def test_cross_run_conflicts_uses_the_provider(self, repo: Repo, project: Path) -> None:
        self._run_with_work(repo, project, "alpha")
        second = self._run_with_work(repo, project, "beta")
        provider = _StubProvider(
            {
                "decisions": [],
                "facts": [],
                "dead_ends": [],
                "open_questions": [],
                "conflicts": [
                    {
                        "id": "c1",
                        "category": "decision",
                        "topic": "auth",
                        "source": "use JWT",
                        "target": "use sessions",
                    }
                ],
                "summary": "",
            }
        )
        conflicts = repo.cross_run_conflicts(second.id, provider=provider)
        assert conflicts
        assert conflicts[0].conflicts[0].topic == "auth"

    def test_cross_run_conflicts_without_provider_is_empty(
        self, repo: Repo, project: Path
    ) -> None:
        session = self._run_with_work(repo, project, "alpha")
        assert repo.cross_run_conflicts(session.id) == []
