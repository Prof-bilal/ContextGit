"""CLI tests. Each command runs in an isolated temp cwd with its own repo."""

import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from contextgit.cli.main import app
from contextgit.core.repo import Repo

runner = CliRunner()


@pytest.fixture
def cwd(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.chdir(tmp_path)
    return tmp_path


def run(*args: str) -> object:
    result = runner.invoke(app, list(args))
    assert result.exit_code == 0, result.output
    return result


class TestInit:
    def test_init_then_commit_flow(self, cwd: Path) -> None:
        run("init")
        run("commit", "design a rate limiter", "--model", "test-model")
        result = run("log")
        assert "design a rate limiter" not in result.output  # summary empty; id shown
        assert "root" in result.output

    def test_init_twice_fails(self, cwd: Path) -> None:
        run("init")
        result = runner.invoke(app, ["init"])
        assert result.exit_code == 1
        assert "error" in result.output

    def test_commit_outside_repo_fails(self, cwd: Path) -> None:
        result = runner.invoke(app, ["commit", "x", "--model", "m"])
        assert result.exit_code == 1


class TestLogJson:
    def test_log_json(self, cwd: Path) -> None:
        run("init")
        run("commit", "hello", "--model", "m", "--summary", "first one")
        result = run("log", "--json")
        data = json.loads(result.output)
        assert len(data) == 2
        assert data[0]["summary"] == "first one"
        assert data[0]["messages"][0]["content"] == "hello"
        assert data[-1]["kind"] == "root"


class TestBranchCheckout:
    def test_branch_list_create_checkout(self, cwd: Path) -> None:
        run("init")
        run("commit", "base", "--model", "m")
        run("branch", "redis-bucket")
        result = run("branch")
        assert "* main" in result.output
        assert "redis-bucket" in result.output
        run("checkout", "redis-bucket")
        result = run("branch")
        assert "* redis-bucket" in result.output

    def test_branch_json_list(self, cwd: Path) -> None:
        run("init")
        result = run("branch", "--json")
        data = json.loads(result.output)
        assert [b["name"] for b in data] == ["main"]

    def test_checkout_missing_fails(self, cwd: Path) -> None:
        run("init")
        result = runner.invoke(app, ["checkout", "ghost"])
        assert result.exit_code == 1


class TestForkFromCommit:
    def test_branch_from_older_commit_isolates_context(self, cwd: Path) -> None:
        run("init")
        run("commit", "one", "--model", "m")
        # capture the first commit id from log --json
        data = json.loads(run("log", "--json").output)
        first_id = data[-1]["id"] if data[-1]["kind"] == "root" else data[0]["id"]
        # root has no message; get the actual first normal commit id
        first_normal = next(c for c in data if c["kind"] == "normal")
        assert first_normal["parents"][0] == first_id  # parent is root
        run("branch", "spec-v2", "--from", first_normal["id"])
        run("checkout", "spec-v2")
        result = run("context")
        assert "one" in result.output


class TestContextAndTag:
    def test_context_command(self, cwd: Path) -> None:
        run("init")
        run("commit", "what is 2+2?", "--model", "m")
        result = run("context")
        assert "what is 2+2?" in result.output
        result = run("context", "--json")
        data = json.loads(result.output)
        assert data[-1]["content"] == "what is 2+2?"

    def test_tag(self, cwd: Path) -> None:
        run("init")
        run("commit", "base", "--model", "m")
        run("tag", "known-good", "--label", "works")
        # tags are visible through the API
        repo = Repo.open(cwd)
        tags = repo.list_tags()
        assert len(tags) == 1
        assert tags[0].label == "works"
