"""Diff and merge behavior tests use only deterministic providers."""

import json
from pathlib import Path

import pytest

from contextgit.core.errors import (
    InvalidMergeResolution,
    MergeConflict,
    StaleMergePreview,
)
from contextgit.core.models import Message
from contextgit.core.repo import Repo
from contextgit.llm.fake import FakeProvider


def forked_repo(path: Path) -> tuple[Repo, str, str]:
    repo = Repo.init(path)
    repo.commit([Message(role="user", content="shared baseline")], model="m")
    ancestor = repo.log()[0].id
    repo.branch("source")
    repo.commit(
        [Message(role="user", content="source adds redis decision")],
        model="m",
        branch="source",
    )
    repo.commit([Message(role="user", content="target adds audit fact")], model="m", branch="main")
    return repo, ancestor, repo.log(branch="source")[0].id


def test_common_ancestor_and_message_diff(tmp_path: Path) -> None:
    repo, ancestor, source_head = forked_repo(tmp_path / "repo")
    assert repo.common_ancestor("source", "main") == ancestor
    result = repo.diff("source", "main")
    assert result.ancestor_id == ancestor
    assert [m.content for m in result.a_messages] == ["source adds redis decision"]
    assert [m.content for m in result.b_messages] == ["target adds audit fact"]
    assert result.a_token_count > 0
    assert result.token_delta == result.b_token_count - result.a_token_count
    assert repo.common_ancestor(source_head, repo.log(branch="main")[0].id) == ancestor


def test_preview_is_non_mutating_and_falls_back_to_verbatim(tmp_path: Path) -> None:
    repo, _, _ = forked_repo(tmp_path / "repo")
    main_head = repo.log(branch="main")[0].id
    preview = repo.preview_merge("source", "main")
    assert preview.fallback is True
    assert preview.summary_confidence == "low"
    assert "source adds redis decision" in preview.summary
    assert repo.log(branch="main")[0].id == main_head


def test_merge_creates_commit_with_two_parents(tmp_path: Path) -> None:
    repo, _, _ = forked_repo(tmp_path / "repo")
    preview = repo.preview_merge("source", "main")
    merged = repo.apply_merge(preview)
    assert merged.kind == "merge"
    assert merged.parent_ids == [preview.target_head_id, preview.source_head_id]
    assert repo.log(branch="main")[0].id == merged.id
    assert repo.log(branch="source")[0].id == preview.source_head_id
    assert repo.build_context(merged.id)[-1].content == preview.summary


def test_conflicts_must_be_resolved_and_support_pick_or_edit(tmp_path: Path) -> None:
    repo, _, _ = forked_repo(tmp_path / "repo")
    provider = FakeProvider(
        default=json.dumps(
            {
                "decisions": ["Use Redis"],
                "facts": [],
                "dead_ends": [],
                "open_questions": [],
                "conflicts": [
                    {
                        "id": "logging",
                        "category": "decision",
                        "topic": "logging",
                        "source": "sample logs",
                        "target": "log every request",
                    }
                ],
                "summary": "Use Redis and retain the selected logging policy.",
            }
        )
    )
    preview = repo.preview_merge("source", "main", provider=provider)
    assert len(preview.conflicts) == 1
    with pytest.raises(MergeConflict):
        repo.apply_merge(preview)
    with pytest.raises(InvalidMergeResolution):
        repo.apply_merge(preview, resolutions={"missing": "source"})
    merged = repo.apply_merge(preview, resolutions={"logging": "edit: log sampled requests"})
    assert "Resolved logging: edit: log sampled requests" in merged.summary
    assert merged.parent_ids == [preview.target_head_id, preview.source_head_id]


def test_provider_schema_error_falls_back_after_retry(tmp_path: Path) -> None:
    repo, _, _ = forked_repo(tmp_path / "repo")
    provider = FakeProvider(default="not JSON")
    preview = repo.preview_merge("source", "main", provider=provider)
    assert preview.fallback
    assert len(provider.calls) == 2


def test_stale_preview_cannot_be_applied(tmp_path: Path) -> None:
    repo, _, _ = forked_repo(tmp_path / "repo")
    preview = repo.preview_merge("source", "main")
    repo.commit([Message(role="user", content="new target change")], model="m", branch="main")
    with pytest.raises(StaleMergePreview):
        repo.apply_merge(preview)


def test_note_is_a_normal_parented_commit(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    note = repo.note("Rejected in-process counters: failover resets quota.")
    assert note.kind == "note"
    assert note.parent_ids == [repo.log()[1].id]
    assert repo.build_context(note.id)[-1].content.startswith("Rejected in-process")
