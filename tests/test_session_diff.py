"""Working-tree diff reads: tracked edits, deletions and untracked files."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from contextgit.gitops.diff import working_tree_diff


@pytest.fixture(autouse=True)
def _isolate_git_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ignore any inherited GIT_DIR/GIT_WORK_TREE so git reads the tmp repo."""
    monkeypatch.delenv("GIT_DIR", raising=False)
    monkeypatch.delenv("GIT_WORK_TREE", raising=False)


def _git(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def _commit(root: Path) -> None:
    _git(root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init")


def test_working_tree_diff_lists_changed_files(tmp_path: Path) -> None:
    root = tmp_path / "repo"
    root.mkdir()
    _git(root, "init", "-q")
    (root / "modified.txt").write_text("one\ntwo\n", encoding="utf-8")
    (root / "deleted.txt").write_text("gone\n", encoding="utf-8")
    _git(root, "add", ".")
    _commit(root)

    (root / "modified.txt").write_text("one\nchanged\n", encoding="utf-8")
    (root / "deleted.txt").unlink()
    (root / "added.txt").write_text("hello\nworld\n", encoding="utf-8")
    (root / "blob.bin").write_bytes(b"\x00\x01\x02binary")

    result = working_tree_diff(root)

    assert result["base"] == "HEAD"
    assert result["truncated"] is False
    files = {item["path"]: item for item in result["files"]}
    assert [item["path"] for item in result["files"]] == sorted(files)

    modified = files["modified.txt"]
    assert modified["status"] == "M"
    assert (modified["additions"], modified["deletions"]) == (1, 1)
    assert modified["binary"] is False
    assert "+changed" in modified["diff"]

    deleted = files["deleted.txt"]
    assert deleted["status"] == "D"
    assert (deleted["additions"], deleted["deletions"]) == (0, 1)

    added = files["added.txt"]
    assert added["status"] == "A"
    assert (added["additions"], added["deletions"]) == (2, 0)
    assert added["binary"] is False
    assert "+hello" in added["diff"]

    blob = files["blob.bin"]
    assert blob["status"] == "A"
    assert blob["binary"] is True
    assert blob["diff"] == ""


def test_working_tree_diff_outside_git_returns_no_files(tmp_path: Path) -> None:
    result = working_tree_diff(tmp_path)

    assert result == {"base": "HEAD", "files": [], "truncated": False}
