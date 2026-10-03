"""Core repo integration tests (temp SQLite per test, no network).

Includes the invariant property tests required by testing.md:
- same input -> same commit hash
- checkout(commit) then build_context is stable
- deleting a branch never removes commits
"""

import tempfile
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from contextgit.core.errors import (
    BranchNotFound,
    CommitNotFound,
    InvalidRefName,
    RepoAlreadyExists,
    RepoNotFound,
)
from contextgit.core.models import Message
from contextgit.core.repo import Repo


class TestInit:
    def test_init_creates_main_with_root_commit(self, repo_path: Path) -> None:
        repo = Repo.init(repo_path)
        assert repo.current_branch() == "main"
        log = repo.log()
        assert len(log) == 1
        assert log[0].kind == "root"
        assert log[0].messages == []

    def test_init_twice_raises(self, repo_path: Path) -> None:
        Repo.init(repo_path)
        with pytest.raises(RepoAlreadyExists):
            Repo.init(repo_path)

    def test_open_missing_raises(self, tmp_path: Path) -> None:
        with pytest.raises(RepoNotFound):
            Repo.open(tmp_path / "nope")


class TestCommit:
    def test_commit_appends_and_moves_head(self, repo: Repo) -> None:
        c1 = repo.commit([Message(role="user", content="design a rate limiter")], model="m1")
        c2 = repo.commit([Message(role="user", content="spec the limit")], model="m1")
        log = repo.log()
        assert log[-1].kind == "root"
        assert c1.parent_ids == [log[-1].id]  # parent is the root commit
        assert c2.parent_ids == [c1.id]
        assert [c.id for c in log] == [c2.id, c1.id, log[2].id]

    def test_commit_id_matches_hashing(self, repo: Repo) -> None:
        from contextgit.core.hashing import commit_id as compute

        c = repo.commit([Message(role="user", content="hello")], model="mm", author="a")
        assert c.id == compute(
            parent_ids=[c.parent_ids[0]], messages=[("user", "hello")], kind="normal", model="mm"
        )

    def test_empty_context_at_root(self, repo: Repo) -> None:
        root_id = repo.log()[-1].id
        assert repo.build_context(root_id) == []


class TestContext:
    def test_build_context_reconstructs_history(self, repo: Repo) -> None:
        repo.commit([Message(role="system", content="sys")], model="m")
        repo.commit([Message(role="user", content="q1")], model="m")
        c3 = repo.commit([Message(role="assistant", content="a1")], model="m")
        ctx = repo.build_context(c3.id)
        assert [(m.role, m.content) for m in ctx] == [
            ("system", "sys"),
            ("user", "q1"),
            ("assistant", "a1"),
        ]

    def test_build_context_stable_across_calls(self, repo: Repo) -> None:
        repo.commit([Message(role="user", content="q")], model="m")
        head = repo.log()[0]
        assert repo.build_context(head.id) == repo.build_context(head.id)

    @settings(max_examples=50, deadline=None)
    @given(n=st.integers(min_value=1, max_value=12), seed=st.integers(0, 2**32))
    def test_property_context_is_prefix_chain(self, n: int, seed: int) -> None:
        """build_context(commit_k) == build_context(commit_{k-1}) + messages_k."""
        with tempfile.TemporaryDirectory() as td:
            repo = Repo.init(Path(td) / "repo")
            repo.commit([Message(role="user", content=f"seed {seed}")], model="m")
            contexts: list[list[str]] = []
            for i in range(n):
                c = repo.commit([Message(role="user", content=f"msg {seed} {i}")], model="m")
                contexts.append([m.content for m in repo.build_context(c.id)])
        for k in range(1, len(contexts)):
            assert contexts[k][: len(contexts[k - 1])] == contexts[k - 1]

    def test_build_context_unknown_commit(self, repo: Repo) -> None:
        with pytest.raises(CommitNotFound):
            repo.build_context("f" * 64)


class TestBranches:
    def test_branch_from_head_and_checkout(self, repo: Repo) -> None:
        repo.commit([Message(role="user", content="q")], model="m")
        repo.branch("redis-bucket")
        repo.checkout("redis-bucket")
        assert repo.current_branch() == "redis-bucket"

    def test_branch_from_specific_commit(self, repo: Repo) -> None:
        c1 = repo.commit([Message(role="user", content="one")], model="m")
        repo.commit([Message(role="user", content="two")], model="m")
        repo.branch("spec-v2", from_commit=c1.id)
        repo.checkout("spec-v2")
        ctx = repo.build_context(repo.log()[0].id)
        assert [m.content for m in ctx] == ["one"]

    def test_branches_are_isolated(self, repo: Repo) -> None:
        repo.commit([Message(role="user", content="shared")], model="m")
        repo.branch("feature")
        repo.checkout("feature")
        repo.commit([Message(role="user", content="on feature")], model="m")
        repo.checkout("main")
        ctx = repo.build_context(repo.log()[0].id)
        assert [m.content for m in ctx] == ["shared"]

    def test_checkout_commit_returns_ref_without_switch(self, repo: Repo) -> None:
        c1 = repo.commit([Message(role="user", content="one")], model="m")
        repo.commit([Message(role="user", content="two")], model="m")
        assert repo.checkout(c1.id) == c1.id
        assert repo.current_branch() == "main"

    def test_checkout_missing_raises(self, repo: Repo) -> None:
        with pytest.raises(BranchNotFound):
            repo.checkout("ghost")

    def test_invalid_branch_name(self, repo: Repo) -> None:
        for bad in ["", "has space", "-dash", "colon:x", "dot."]:
            with pytest.raises(InvalidRefName):
                repo.branch(bad)

    def test_delete_branch_keeps_commits(self, repo: Repo) -> None:
        c1 = repo.commit([Message(role="user", content="one")], model="m")
        repo.branch("temp")
        repo.checkout("temp")
        c2 = repo.commit([Message(role="user", content="two")], model="m")
        repo.checkout("main")
        repo.delete_branch("temp")
        assert repo.current_branch() == "main"
        assert all(b.name != "temp" for b in repo.list_branches())
        # commits survive
        assert repo._storage.has_commit(c2.id)
        ctx = repo.build_context(c2.id)
        assert [m.content for m in ctx] == ["one", "two"]
        assert repo._storage.has_commit(c1.id)

    def test_cannot_delete_current_branch(self, repo: Repo) -> None:
        with pytest.raises(InvalidRefName):
            repo.delete_branch("main")


class TestTags:
    def test_tag_head_and_by_commit(self, repo: Repo) -> None:
        c1 = repo.commit([Message(role="user", content="one")], model="m")
        t1 = repo.tag("known-good", label="works")
        t2 = repo.tag("first", commit_id=c1.id)
        assert t1.commit_id == repo.log()[0].id
        assert t2.commit_id == c1.id
        assert {t.name for t in repo.list_tags()} == {"known-good", "first"}

    def test_tag_unknown_commit(self, repo: Repo) -> None:
        with pytest.raises(CommitNotFound):
            repo.tag("bad", commit_id="f" * 64)


class TestCountTokens:
    def test_counts_grow_with_context(self, repo: Repo) -> None:
        c1 = repo.commit([Message(role="user", content="x" * 40)], model="m")
        c2 = repo.commit([Message(role="user", content="y" * 40)], model="m")
        assert repo.count_tokens(c2.id, "m") > repo.count_tokens(c1.id, "m")

    def test_root_is_zero(self, repo: Repo) -> None:
        assert repo.count_tokens(repo.log()[-1].id, "m") == 0
