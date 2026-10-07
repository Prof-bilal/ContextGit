"""Phase E: scoped, derived memory — including what the runs already rejected."""

from __future__ import annotations

import subprocess
from pathlib import Path

from contextgit.core.models import Message
from contextgit.core.repo import Repo
from contextgit.mcp import tools
from contextgit.memory.bundle import memory_for, scope_files

APP = '''\
from fastapi import FastAPI

app = FastAPI()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
'''

AUTH = '''\
from fastapi import FastAPI

app = FastAPI()


@app.post("/login")
def login() -> dict[str, str]:
    return {"token": "jwt"}
'''

EXTRACTION = (
    '{"decisions": ["Use JWT for sessions"], "facts": [], '
    '"dead_ends": ["Server-side sessions were rejected: they do not scale"], '
    '"open_questions": ["Should refresh tokens rotate?"], "conflicts": [], '
    '"summary": "Switched to JWT."}'
)


class StubProvider:
    def __init__(self, reply: str = EXTRACTION) -> None:
        self.reply = reply
        self.calls = 0

    def complete(self, messages: list[Message], **options: object) -> str:
        self.calls += 1
        return self.reply


def git(project: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=project, check=True, capture_output=True)


def project_with_auth_run(tmp_path: Path, *, scope: list[str] | None = None) -> tuple[Path, Repo]:
    project = tmp_path / "project"
    (project / "src" / "auth").mkdir(parents=True)
    (project / "src" / "auth" / "login.py").write_text(AUTH)
    (project / "README.md").write_text("# app\n")
    git(project, "init", "-q", "-b", "main")
    git(project, "config", "user.email", "t@example.com")
    git(project, "config", "user.name", "t")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "init")

    repo = Repo.init(tmp_path / "repo")
    session = repo.create_session(
        "auth work",
        branch="auth",
        project_path=str(project),
        worktree=True,
        scope=scope,
    )
    repo.commit(
        [Message(role="user", content="use JWT, sessions do not scale")],
        model="test-model",
        branch=session.branch,
        summary="switch auth to JWT",
    )
    worktree = Path(session.worktree_path or "")
    (worktree / "src" / "auth" / "login.py").write_text(
        AUTH.replace('"jwt"', '"jwt-v2"')
    )
    subprocess.run(["git", "add", "-A"], cwd=worktree, check=True, capture_output=True)
    subprocess.run(
        ["git", "commit", "-q", "-m", "switch auth to JWT"],
        cwd=worktree,
        check=True,
        capture_output=True,
    )
    git(project, "merge", "--ff-only", "ctx/auth")
    return project, repo


def test_scope_files_expands_globs_and_skips_build_output(tmp_path: Path) -> None:
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "a.py").write_text("x")
    (tmp_path / "src" / "b.py").write_text("x")
    (tmp_path / "node_modules").mkdir()
    (tmp_path / "node_modules" / "dep.py").write_text("x")

    assert scope_files(tmp_path, ["src/**"]) == ["src/a.py", "src/b.py"]
    # A literal path works too, and a scope that matches nothing returns nothing.
    assert scope_files(tmp_path, ["src/a.py"]) == ["src/a.py"]
    assert scope_files(tmp_path, ["does/not/exist/**"]) == []


def test_memory_is_scoped_to_the_paths_asked_for(tmp_path: Path) -> None:
    project, repo = project_with_auth_run(tmp_path)
    provider = StubProvider()

    scoped = memory_for(repo, provider, project, ["src/auth/**"], scoped_by="task scope")
    assert scoped.files == ["src/auth/login.py"]
    assert scoped.decisions == ["Use JWT for sessions"]
    assert scoped.dead_ends == [
        "Server-side sessions were rejected: they do not scale"
    ]
    assert scoped.runs[0].run_name == "auth work"
    assert provider.calls == 1

    # A path no run touched yields nothing rather than someone else's reasoning.
    elsewhere = memory_for(repo, provider, project, ["README.md"], scoped_by="task scope")
    assert elsewhere.decisions == []
    assert elsewhere.dead_ends == []
    assert elsewhere.note is not None

    # Asking again is free: the extraction is cached.
    memory_for(repo, provider, project, ["src/auth/**"], scoped_by="task scope")
    assert provider.calls == 1


def test_memory_tools_answer_for_a_named_path(
    tmp_path: Path, monkeypatch
) -> None:
    project, repo = project_with_auth_run(tmp_path)
    # The tool resolves the project from the run/cwd; pin it for the test.
    monkeypatch.setattr(tools, "project_path", lambda repo: project)
    # Prime the cache the way the app does, then ask the tools with no provider.
    memory_for(repo, StubProvider(), project, ["src/auth/**"])

    ends = tools.dead_ends(repo, "src/auth/login.py")
    assert ends["dead_ends"] == [
        "Server-side sessions were rejected: they do not scale"
    ]

    decided = tools.decisions(repo, "src/auth/login.py")
    assert decided["decisions"] == ["Use JWT for sessions"]
    assert decided["open_questions"] == ["Should refresh tokens rotate?"]

    everything = tools.memory(repo, "src/auth/**")
    assert everything["dead_ends"] and everything["decisions"]


def test_memory_without_a_scope_says_so(tmp_path: Path) -> None:
    project, repo = project_with_auth_run(tmp_path)
    # No CONTEXTGIT_TASK and no path: the tool must not guess.
    result = tools.memory(repo)
    assert "no scope" in result["note"].lower()


def test_task_scope_drives_the_answer(tmp_path: Path, monkeypatch) -> None:
    project, repo = project_with_auth_run(tmp_path, scope=["src/auth/**"])
    board_team = repo.create_team("mission", project_path=str(project))
    task = repo.create_task(board_team.id, title="Auth", scope=["src/auth/**"])
    monkeypatch.setenv(tools.TASK_ENV, task.id)
    monkeypatch.setattr(tools, "project_path", lambda repo: project)

    assert tools.task_scope(repo) == ["src/auth/**"]
    memory_for(repo, StubProvider(), project, tasks := tools.task_scope(repo))
    assert tasks == ["src/auth/**"]

    answer = tools.dead_ends(repo)
    assert answer["dead_ends"] == [
        "Server-side sessions were rejected: they do not scale"
    ]
    assert answer["scoped_by"] == "your task's scope"


def test_agents_md_carries_the_rejected_alternatives(tmp_path: Path) -> None:
    project, repo = project_with_auth_run(tmp_path, scope=["src/auth/**"])
    # Not cached yet: starting a run must not spend an LLM call, so the section
    # is simply absent until the extraction exists.
    repo.sync_agent_context(str(project))
    body = (project / "AGENTS.md").read_text()
    assert "Already rejected here" not in body

    memory_for(repo, StubProvider(), project, ["src/auth/**"])
    repo.sync_agent_context(str(project))
    body = (project / "AGENTS.md").read_text()
    assert "Already rejected here" in body
    assert "do not scale" in body


def test_endpoint_tools_list_the_projects_surface(
    tmp_path: Path, monkeypatch
) -> None:
    project, repo = project_with_auth_run(tmp_path)
    monkeypatch.setattr(tools, "project_path", lambda repo: project)
    listed = tools.endpoints(repo, path=None)
    # `endpoints()` runs against the process cwd unless a task points elsewhere,
    # so assert on the shape rather than this project's routes.
    assert "endpoints" in listed and "count" in listed

    tests = tools.endpoint_tests(repo)
    assert {"passed", "failed", "stale", "retired", "files"} <= set(tests)

    why = tools.why_line(repo, "src/auth/login.py")
    assert why["path"] == "src/auth/login.py"
    assert why["findings"][0]["run_name"] == "auth work"
