"""Phase F: finding the change that broke behaviour, and the environment behind it."""

from __future__ import annotations

import subprocess
from pathlib import Path

from fastapi.testclient import TestClient

from contextgit.api.app import create_app
from contextgit.core.models import EnvEntry
from contextgit.core.repo import Repo
from contextgit.llm.fake import FakeProvider
from contextgit.verify.bisect import bisect_gate, first_parent_range, oldest_commit
from contextgit.verify.env import capture_env, diff_env, hash_value

CHECK = """\
from app import VALUE

raise SystemExit(0 if VALUE < 2 else 1)
"""

BAD = """\
VALUE = 2
"""


def git(project: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=project, check=True, capture_output=True, text=True
    ).stdout


def commit(project: Path, message: str) -> str:
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", message)
    return git(project, "rev-parse", "HEAD").strip()


def project_with_a_regression(tmp_path: Path) -> tuple[Path, dict[str, str]]:
    """c1 passes, c2 is docs-only, c3 breaks the gate, c4 keeps it broken."""
    project = tmp_path / "project"
    project.mkdir()
    (project / "app.py").write_text("VALUE = 1\n")
    (project / "check.py").write_text(CHECK)
    git(project, "init", "-q", "-b", "main")
    git(project, "config", "user.email", "t@example.com")
    git(project, "config", "user.name", "t")
    shas = {"c1": commit(project, "start")}

    (project / "NOTES.md").write_text("docs only\n")
    shas["c2"] = commit(project, "docs only")

    (project / "app.py").write_text(BAD)
    shas["c3"] = commit(project, "raise the value")

    (project / "NOTES.md").write_text("still docs\n")
    shas["c4"] = commit(project, "more docs")
    return project, shas


# ------------------------------------------------------------------- env --


def test_env_capture_hashes_values_and_names_the_source(tmp_path: Path) -> None:
    (tmp_path / ".env").write_text(
        "# comment\nAPI_URL=https://example.test\nSECRET='super-secret'\nEMPTY=\n"
    )
    (tmp_path / ".env.local").write_text("API_URL=https://local.test\nLOCAL_ONLY=1\n")

    entries = capture_env(tmp_path, {"PORT": "3000", "NODE_ENV": "development"})
    by_key = {entry.key: entry for entry in entries}

    assert set(by_key) >= {"API_URL", "SECRET", "LOCAL_ONLY", "PORT", "NODE_ENV"}
    # A later file wins for the same key, and the value is never stored.
    assert by_key["API_URL"].source == ".env.local"
    assert by_key["API_URL"].hash == hash_value("https://local.test")
    assert "super-secret" not in by_key["SECRET"].hash
    assert by_key["SECRET"].hash == hash_value("super-secret")
    assert by_key["PORT"].source == "process"


def test_env_drift_reports_added_removed_and_changed() -> None:
    before = [
        EnvEntry(key="API_URL", hash="aaaa", source=".env"),
        EnvEntry(key="OLD_FLAG", hash="bbbb", source=".env"),
    ]
    after = [
        EnvEntry(key="API_URL", hash="cccc", source=".env"),
        EnvEntry(key="NEW_FLAG", hash="dddd", source=".env"),
    ]
    drift = {item.key: item.change for item in diff_env(before, after)}
    assert drift == {"API_URL": "changed", "NEW_FLAG": "added", "OLD_FLAG": "removed"}


def test_a_run_records_its_environment(tmp_path: Path) -> None:
    project, _ = project_with_a_regression(tmp_path)
    (project / ".env").write_text("DATABASE_URL=postgres://localhost/dev\n")
    repo = Repo.init(tmp_path / "repo")

    session = repo.create_session("first", branch="first", project_path=str(project))
    recorded = {entry.key for entry in repo.run_env(session.id)}
    assert "DATABASE_URL" in recorded
    assert "NODE_ENV" not in recorded or recorded  # process keys are optional

    (project / ".env").write_text("DATABASE_URL=postgres://localhost/dev\nCACHE=redis\n")
    second = repo.create_session("second", branch="second", project_path=str(project))
    drift = {item.key: item.change for item in repo.env_drift(second.id, session.id)}
    assert drift == {"CACHE": "added"}  # only the new key differs


# ---------------------------------------------------------------- bisect --


def test_bisect_finds_the_commit_that_broke_the_gate(tmp_path: Path) -> None:
    project, shas = project_with_a_regression(tmp_path)
    repo = Repo.init(tmp_path / "repo")

    commits = first_parent_range(project, shas["c1"], shas["c4"])
    assert commits == [shas["c2"], shas["c3"], shas["c4"]]
    assert oldest_commit(project) == shas["c1"]

    result = bisect_gate(
        repo, project, good=shas["c1"], bad=shas["c4"], command="python check.py"
    )
    assert result.culprit == shas["c3"]
    assert result.culprit_summary == "raise the value"
    assert result.probes <= 4  # logarithmic, ends checked once each
    assert "raise the value" not in result.note if result.note else True
    # Probes are thrown away: the user's checkout and worktrees are untouched.
    assert not (project / ".contextgit" / "bisect").exists()
    assert git(project, "status", "--porcelain").strip() == ""


def test_bisect_refuses_when_the_ends_do_not_bracket(tmp_path: Path) -> None:
    project, shas = project_with_a_regression(tmp_path)
    repo = Repo.init(tmp_path / "repo")

    # A "good" that already fails cannot be bisected.
    not_good = bisect_gate(
        repo, project, good=shas["c4"], bad=shas["c4"], command="python check.py"
    )
    assert not_good.culprit is None
    assert not_good.note is not None

    passing = bisect_gate(
        repo, project, good=shas["c1"], bad=shas["c1"], command="python check.py"
    )
    assert passing.culprit is None
    assert passing.note is not None
    assert "nothing changed" in passing.note.lower()


def test_bisect_needs_a_command(tmp_path: Path) -> None:
    project, shas = project_with_a_regression(tmp_path)
    repo = Repo.init(tmp_path / "repo")
    result = bisect_gate(
        repo, project, good=shas["c1"], bad=shas["c4"], command="", max_probes=2
    )
    # No gate is detectable in this fixture, so we say so rather than guessing.
    assert result.culprit is None
    assert result.note


def test_bisect_route_returns_the_culprit(tmp_path: Path) -> None:
    project, shas = project_with_a_regression(tmp_path)
    repo = Repo.init(tmp_path / "repo")
    client = TestClient(create_app(repo=repo, provider=FakeProvider()))

    response = client.post(
        "/api/v1/endpoints/tests/bisect",
        json={
            "project_path": str(project),
            "good": shas["c1"],
            "bad": shas["c4"],
            "command": "python check.py",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["culprit"] == shas["c3"]
    assert body["probes"] >= 2

    same = client.post(
        "/api/v1/endpoints/tests/bisect",
        json={"project_path": str(project), "good": shas["c4"], "bad": shas["c4"]},
    )
    assert same.status_code == 200
    assert same.json()["culprit"] is None
    assert same.json()["note"]
