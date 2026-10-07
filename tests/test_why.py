"""Phase D: the Why lens — the reasoning behind a line, cached and never guessed."""

from __future__ import annotations

import subprocess
from pathlib import Path

from fastapi.testclient import TestClient

from contextgit.api.app import create_app
from contextgit.core.models import Message
from contextgit.core.repo import Repo
from contextgit.endpoints import why_for, why_history
from contextgit.endpoints.why import cached_extraction_count
from contextgit.llm.fake import FakeProvider

APP = '''\
from fastapi import FastAPI

app = FastAPI()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
'''

EXTRACTION = (
    '{"decisions": ["Use JWT for sessions"], '
    '"facts": ["Tokens are stateless"], '
    '"dead_ends": ["Server-side sessions were rejected: they do not scale across regions"], '
    '"open_questions": ["Should refresh tokens rotate?"], '
    '"conflicts": [], "summary": "Switched to JWT."}'
)


class StubProvider:
    """A provider that records how often it was asked."""

    def __init__(self, reply: str = EXTRACTION) -> None:
        self.reply = reply
        self.calls = 0

    def complete(self, messages: list[Message], **options: object) -> str:
        self.calls += 1
        return self.reply


def git(project: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=project, check=True, capture_output=True)


def project_with_run(tmp_path: Path) -> tuple[Path, Repo]:
    """A git project plus a recorded run whose code landed on main."""
    project = tmp_path / "project"
    project.mkdir()
    (project / "app.py").write_text(APP)
    git(project, "init", "-q", "-b", "main")
    git(project, "config", "user.email", "t@example.com")
    git(project, "config", "user.name", "t")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "add health")

    repo = Repo.init(tmp_path / "repo")
    session = repo.create_session(
        "checkout flow", branch="checkout", project_path=str(project), worktree=True
    )
    assert session.git_branch == "ctx/checkout"
    repo.commit(
        [
            Message(role="user", content="switch auth to JWT because sessions do not scale"),
            Message(role="assistant", content="Server-side sessions are out; JWT it is."),
        ],
        model="test-model",
        branch=session.branch,
        summary="switch auth to JWT",
    )

    # The run's code lands on main, the way integration does.
    worktree = Path(session.worktree_path or "")
    (worktree / "app.py").write_text(APP.replace('"status": "ok"', '"status": "jwt"'))
    subprocess.run(["git", "add", "-A"], cwd=worktree, check=True, capture_output=True)
    subprocess.run(
        ["git", "commit", "-q", "-m", "switch auth to JWT"],
        cwd=worktree,
        check=True,
        capture_output=True,
    )
    git(project, "merge", "--ff-only", "ctx/checkout")
    return project, repo


def test_history_lists_the_files_changes_newest_first(tmp_path: Path) -> None:
    project, repo = project_with_run(tmp_path)
    history = why_history(repo, project, "app.py")
    assert [item.summary for item in history] == ["switch auth to JWT", "add health"]
    # The newest change came from the recorded run; the first did not.
    assert history[0].tracked is True
    assert history[0].run_name == "checkout flow"
    assert history[1].tracked is False


def test_reasoning_is_extracted_and_cached(tmp_path: Path) -> None:
    project, repo = project_with_run(tmp_path)
    provider = StubProvider()

    answer = why_for(repo, provider, project, "app.py")
    assert answer.reasoned is True
    finding = answer.findings[0]
    assert finding.decisions == ["Use JWT for sessions"]
    assert finding.dead_ends == [
        "Server-side sessions were rejected: they do not scale across regions"
    ]
    assert finding.open_questions == ["Should refresh tokens rotate?"]
    assert finding.model == "test-model"
    assert "sessions do not scale" in (finding.excerpt or "")
    assert provider.calls == 1
    assert cached_extraction_count(project) == 1

    # Second ask: served from the cache, the provider is not called again.
    again = why_for(repo, provider, project, "app.py")
    assert again.findings[0].decisions == ["Use JWT for sessions"]
    assert provider.calls == 1


def test_without_a_provider_we_say_so_instead_of_guessing(tmp_path: Path) -> None:
    project, repo = project_with_run(tmp_path)
    answer = why_for(repo, None, project, "app.py")
    assert answer.reasoned is False
    assert answer.note is not None and "Connect a provider" in answer.note
    assert answer.findings[0].decisions == []


def test_an_untracked_change_has_no_reasoning_to_show(tmp_path: Path) -> None:
    project, repo = project_with_run(tmp_path)
    git(project, "commit", "-q", "--allow-empty", "-m", "unrelated")
    answer = why_for(repo, StubProvider(), project, "app.py")
    # The newest change to app.py is still the run's, so target the plain commit.
    history = why_history(repo, project, "app.py")
    plain = next(item for item in history if not item.tracked)
    assert plain.decisions == []
    assert answer.path == "app.py"


def test_why_routes_answer(tmp_path: Path) -> None:
    project, repo = project_with_run(tmp_path)
    client = TestClient(create_app(repo=repo, provider=FakeProvider()))

    response = client.get(
        "/api/v1/why",
        params={"project_path": str(project), "path": "app.py"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["path"] == "app.py"
    assert body["findings"][0]["run_name"] == "checkout flow"

    history = client.get(
        "/api/v1/why/history",
        params={"project_path": str(project), "path": "app.py"},
    )
    assert history.status_code == 200
    assert [item["summary"] for item in history.json()] == [
        "switch auth to JWT",
        "add health",
    ]


def test_unknown_path_says_there_is_nothing_yet(tmp_path: Path) -> None:
    project, repo = project_with_run(tmp_path)
    answer = why_for(repo, None, project, "does/not/exist.py")
    assert answer.findings == []
    assert answer.note is not None and "No recorded changes" in answer.note
