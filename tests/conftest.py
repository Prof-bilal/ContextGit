"""Shared fixtures."""

from collections.abc import Iterator
from pathlib import Path

import pytest

from contextgit.core.repo import Repo


@pytest.fixture
def repo_path(tmp_path: Path) -> Path:
    return tmp_path / "repo"


@pytest.fixture
def repo(repo_path: Path) -> Iterator[Repo]:
    yield Repo.init(repo_path, author="tester")
