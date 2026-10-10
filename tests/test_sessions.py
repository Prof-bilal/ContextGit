"""Sessions: parallel AI runs with commit-on-demand staging."""

from pathlib import Path

import pytest

from contextgit.core.errors import (
    BranchNotFound,
    CommitNotFound,
    InvalidRefName,
    SessionNotFound,
    StagingEmpty,
)
from contextgit.core.models import Message, Session
from contextgit.core.repo import Repo, _project_from_worktree
from contextgit.gitops.context import context_document


def _messages(*contents: str) -> list[Message]:
    return [Message(role="user", content=content) for content in contents]


class TestSessions:
    def test_create_session_creates_bound_branch(self, repo: Repo) -> None:
        session = repo.create_session("claude fix", kind="terminal", agent="claude")
        assert session.kind == "terminal"
        assert session.agent == "claude"
        assert session.status == "idle"
        assert not session.auto_commit
        assert repo.get_session(session.id).branch == session.branch
        assert repo.get_branch(session.branch) is not None

    def test_session_branch_names_are_unique_and_valid(self, repo: Repo) -> None:
        first = repo.create_session("fix bug")
        second = repo.create_session("fix bug")
        assert first.branch != second.branch
        assert " " not in first.branch
        assert repo.get_branch(first.branch)
        assert repo.get_branch(second.branch)

    def test_session_can_bind_existing_branch(self, repo: Repo) -> None:
        repo.branch("feature-x")
        session = repo.create_session("on feature", branch="feature-x")
        assert session.branch == "feature-x"

    def test_session_on_missing_branch_creates_it_from_commit(self, repo: Repo) -> None:
        session = repo.create_session("explorer", branch="fresh-branch")
        assert repo.get_branch("fresh-branch").head_commit_id == session_branch_head(
            repo, session.branch
        )

    def test_list_get_and_delete(self, repo: Repo) -> None:
        kept = repo.create_session("keep")
        removed = repo.create_session("remove")
        ids = {item.id for item in repo.list_sessions()}
        assert {kept.id, removed.id} <= ids
        repo.delete_session(removed.id)
        with pytest.raises(SessionNotFound):
            repo.get_session(removed.id)
        assert repo.get_session(kept.id).name == "keep"

    def test_delete_session_removes_private_branch_and_commits(self, repo: Repo) -> None:
        session = repo.create_session("temp")
        branch = session.branch
        repo.stage(session.id, _messages("hello"))
        commit = repo.commit_staged(session.id)
        repo.delete_session(session.id)
        with pytest.raises(BranchNotFound):
            repo.get_branch(branch)
        with pytest.raises(CommitNotFound):
            repo.get_commit(commit.id)

    def test_trash_and_restore_hides_then_reveals(self, repo: Repo) -> None:
        kept = repo.create_session("keep")
        trashed = repo.create_session("hush")
        branch = trashed.branch
        repo.trash_session(trashed.id)
        assert trashed.id not in {item.id for item in repo.list_sessions()}
        assert trashed.id in {item.id for item in repo.list_trashed_sessions()}
        # The branch and its commits survive while the run sits in Storage.
        assert repo.get_branch(branch).head_commit_id
        restored = repo.restore_session(trashed.id)
        assert restored.deleted_at is None
        assert {kept.id, trashed.id} <= {item.id for item in repo.list_sessions()}
        assert trashed.id not in {item.id for item in repo.list_trashed_sessions()}

    def test_restoring_a_conversation_brings_both_halves_back(self, repo: Repo) -> None:
        session = repo.create_session("chat pair", kind="chat", branch="chat/pair")
        repo.trash_session(session.id)
        repo.delete_branch("chat/pair")
        # Restoring the branch also restores the chat session bound to it.
        repo.restore_branch("chat/pair")
        assert repo.get_session(session.id).deleted_at is None
        # The other direction: restoring the session restores its branch too.
        repo.trash_session(session.id)
        repo.delete_branch("chat/pair")
        repo.restore_session(session.id)
        assert not repo._storage.branch_is_trashed("chat/pair")

    def test_create_session_reuses_trashed_branch_name(self, repo: Repo) -> None:
        original = repo.create_session("naming", branch="named-branch")
        repo.trash_session(original.id)
        repo.delete_branch("named-branch")
        assert repo._storage.branch_is_trashed("named-branch")
        fresh = repo.create_session("naming again", branch="named-branch")
        assert fresh.branch == "named-branch"
        assert not repo._storage.branch_is_trashed("named-branch")

    def test_status_and_auto_commit_updates(self, repo: Repo) -> None:
        session = repo.create_session("runner")
        running = repo.set_session_status(session.id, "running")
        assert running.status == "running"
        toggled = repo.set_session_auto_commit(session.id, True)
        assert toggled.auto_commit is True
        assert repo.get_session(session.id).status == "running"
        with pytest.raises(InvalidRefName):
            repo.set_session_status(session.id, "sideways")

    def test_session_stores_role_and_skills(self, repo: Repo) -> None:
        skills = ["UI research", "UI design", "UI build", "Responsive check", "Accessibility check"]
        session = repo.create_session(
            "frontend run",
            kind="terminal",
            agent="claude",
            role="Frontend Developer",
            skills=skills,
        )
        stored = repo.get_session(session.id)
        assert stored.role == "Frontend Developer"
        assert stored.skills == skills

    def test_session_without_role_defaults_empty(self, repo: Repo) -> None:
        stored = repo.get_session(repo.create_session("plain run").id)
        assert stored.role is None
        assert stored.skills == []

    def test_session_stores_its_project(self, repo: Repo) -> None:
        session = repo.create_session("grouped run", project_path="/home/me/warden")
        assert repo.get_session(session.id).project_path == "/home/me/warden"

    def test_session_without_project_defaults_none(self, repo: Repo) -> None:
        assert repo.get_session(repo.create_session("loose run").id).project_path is None


class TestStaging:
    def test_stage_accumulates_without_committing(self, repo: Repo) -> None:
        session = repo.create_session("stager")
        repo.stage(session.id, _messages("one"))
        staged = repo.stage(session.id, _messages("two", "three"))
        assert [m.content for m in staged] == ["one", "two", "three"]
        head_before = repo.get_branch(session.branch).head_commit_id
        assert head_before == repo.get_branch(repo.current_branch()).head_commit_id
        assert len(repo.log(session.branch)) == 1  # only the root commit

    def test_commit_staged_moves_messages_and_clears_buffer(self, repo: Repo) -> None:
        session = repo.create_session("committer")
        repo.stage(session.id, _messages("first", "second"))
        commit = repo.commit_staged(session.id, summary="did things")
        assert [m.content for m in commit.messages] == ["first", "second"]
        assert commit.summary == "did things"
        assert repo.staged(session.id) == []
        assert repo.get_branch(session.branch).head_commit_id == commit.id
        context = repo.build_context(commit.id)
        assert [m.content for m in context] == ["first", "second"]

    def test_commit_staged_on_branch_independent_of_head(self, repo: Repo) -> None:
        repo.checkout("main")
        session = repo.create_session("side run")
        repo.stage(session.id, _messages("side note"))
        commit = repo.commit_staged(session.id)
        assert repo.current_branch() == "main"
        assert repo.get_branch("main").head_commit_id != commit.id
        assert repo.get_branch(session.branch).head_commit_id == commit.id

    def test_commit_empty_staging_raises(self, repo: Repo) -> None:
        session = repo.create_session("empty")
        with pytest.raises(StagingEmpty):
            repo.commit_staged(session.id)

    def test_stage_empty_list_raises(self, repo: Repo) -> None:
        session = repo.create_session("nothing")
        with pytest.raises(StagingEmpty):
            repo.stage(session.id, [])

    def test_stage_unknown_session_raises(self, repo: Repo) -> None:
        with pytest.raises(SessionNotFound):
            repo.stage("missing-session", _messages("x"))

    def test_unstage_clears_and_last_only(self, repo: Repo) -> None:
        session = repo.create_session("unstager")
        repo.stage(session.id, _messages("a", "b", "c"))
        remaining = repo.unstage(session.id, last_only=True)
        assert [m.content for m in remaining] == ["a", "b"]
        assert repo.unstage(session.id) == []
        assert repo.staged(session.id) == []

    def test_default_summary_is_first_user_message(self, repo: Repo) -> None:
        session = repo.create_session("summarizer")
        repo.stage(
            session.id,
            [
                Message(role="assistant", content="context"),
                Message(role="user", content="the actual question"),
            ],
        )
        commit = repo.commit_staged(session.id)
        assert commit.summary == "the actual question"

    def test_commit_staged_uses_session_agent_as_model(self, repo: Repo) -> None:
        session = repo.create_session("agent run", kind="terminal", agent="codex")
        repo.stage(session.id, _messages("work done"))
        commit = repo.commit_staged(session.id)
        assert commit.model == "codex"


def session_branch_head(repo: Repo, branch: str) -> str:
    return repo.get_branch(branch).head_commit_id


def test_context_document_lists_role_and_skills() -> None:
    body = context_document(
        [
            {
                "name": "run-a",
                "agent": "claude",
                "scope": "src/**",
                "role": "Backend Developer",
                "skills": "API design, Data modeling",
            }
        ]
    )
    assert "role: Backend Developer" in body
    assert "skills: API design, Data modeling" in body


def test_context_document_omits_role_when_absent() -> None:
    body = context_document([{"name": "run-b", "agent": "claude", "scope": ""}])
    assert "role:" not in body
    assert "skills:" not in body


def test_project_from_worktree_recovers_the_project() -> None:
    assert _project_from_worktree("/home/me/warden/.contextgit/worktrees/run") == "/home/me/warden"
    assert _project_from_worktree("/tmp/not-a-worktree") is None
    assert _project_from_worktree("/tmp/.contextgit/worktrees/run/extra") is None


def test_list_sessions_backfills_project_from_worktree(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    repo._storage.insert_session(
        Session(
            id="legacy-run",
            name="old run",
            kind="terminal",
            branch="legacy",
            worktree_path="/home/me/warden/.contextgit/worktrees/legacy",
        )
    )
    listing = repo.list_sessions()
    assert next(s for s in listing if s.id == "legacy-run").project_path == "/home/me/warden"
