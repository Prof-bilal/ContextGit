"""Contract fixtures are not substitutes for live harness verification."""

import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from contextgit.api.app import create_app
from contextgit.core.repo import Repo
from contextgit.integration.transcript import CaptureUnavailable, opencode_messages


@pytest.fixture
def capture_repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path))
    project = tmp_path / "project"
    project.mkdir()
    directory = tmp_path / "opencode"
    directory.mkdir()
    database = directory / "opencode.db"
    with sqlite3.connect(database) as conn:
        conn.executescript("""
            CREATE TABLE session(id TEXT, directory TEXT, title TEXT, time_updated INTEGER);
            CREATE TABLE message(id TEXT, session_id TEXT, data TEXT, time_created INTEGER);
            CREATE TABLE part(id TEXT, message_id TEXT, data TEXT, time_created INTEGER);
        """)
        for native_id, location in [
            ("one", project),
            ("two", project),
            ("foreign", tmp_path / "other"),
        ]:
            conn.execute(
                "INSERT INTO session VALUES (?, ?, ?, ?)",
                (native_id, str(location), native_id, 1000),
            )
            for index, (role, text) in enumerate(
                [
                    ("user", "Same prompt\nsecond line"),
                    ("assistant", f"Reply from {native_id}\nmultiline output"),
                ]
            ):
                message_id = f"{native_id}-{index}"
                data = {"role": role, "time": {"completed": 1100}, "tokens": 7437}
                conn.execute(
                    "INSERT INTO message VALUES (?, ?, ?, ?)",
                    (message_id, native_id, json.dumps(data), 1000 + index),
                )
                conn.execute(
                    "INSERT INTO part VALUES (?, ?, ?, ?)",
                    (message_id, message_id, json.dumps({"type": "text", "text": text}), 1000),
                )
            for index, part in enumerate(
                [
                    {"type": "tool", "text": "Usage junk"},
                    {"type": "text", "text": "synthetic", "synthetic": True},
                ]
            ):
                conn.execute(
                    "INSERT INTO part VALUES (?, ?, ?, ?)",
                    (f"{native_id}-junk-{index}", f"{native_id}-1", json.dumps(part), 1001),
                )
    repo = Repo.init(tmp_path / "repo")
    session = repo.create_session(
        "test", kind="terminal", agent="opencode", project_path=str(project)
    )
    yield repo, session, database


def test_exact_binding_survives_reopen_and_repeated_checkpoints(capture_repo):
    repo, session, _ = capture_repo
    repo.transcripts.bind(session.id, "two")
    messages = repo.transcripts.capture(session.id)
    assert [item.role for item in messages] == ["user", "assistant"]
    assert messages[1].content == "Reply from two\nmultiline output"
    assert repo.transcripts.capture(session.id) == messages
    commit = repo.commit_staged(session.id)
    reopened = Repo.open(repo._root)
    assert reopened.transcripts.capture(session.id) == []
    assert reopened.get_commit(commit.id).messages == messages


def test_missing_binding_never_guesses_even_with_one_candidate(capture_repo):
    repo, session, _ = capture_repo
    with pytest.raises(CaptureUnavailable, match="no saved OpenCode") as error:
        repo.transcripts.capture(session.id)
    assert error.value.status == "unbound"
    choices = repo.transcripts.choices(session.id)
    assert {item["id"] for item in choices} == {"one", "two"}
    with pytest.raises(CaptureUnavailable) as error:
        repo.transcripts.bind(session.id, "foreign")
    assert error.value.status == "wrong_project"


def test_parallel_sessions_and_binding_cannot_be_reassigned(capture_repo):
    repo, session, _ = capture_repo
    other = repo.create_session(
        "other", kind="terminal", agent="opencode", project_path=session.project_path
    )
    repo.transcripts.bind(session.id, "one")
    with pytest.raises(CaptureUnavailable):
        repo.transcripts.bind(other.id, "one")
    with pytest.raises(CaptureUnavailable):
        repo.transcripts.bind(session.id, "two")
    repo.transcripts.bind(other.id, "two")
    assert repo.transcripts.capture(session.id)[1].content.startswith("Reply from one")
    assert repo.transcripts.capture(other.id)[1].content.startswith("Reply from two")


def test_incomplete_reply_stages_nothing_and_can_be_retried(capture_repo):
    repo, session, database = capture_repo
    repo.transcripts.bind(session.id, "one")
    with sqlite3.connect(database) as conn:
        conn.execute(
            "UPDATE message SET data = ? WHERE id = 'one-1'",
            (json.dumps({"role": "assistant", "time": {}}),),
        )
    with pytest.raises(CaptureUnavailable) as error:
        repo.transcripts.capture(session.id)
    assert error.value.status == "incomplete"
    assert repo.staged(session.id) == []
    with sqlite3.connect(database) as conn:
        conn.execute(
            "UPDATE message SET data = ? WHERE id = 'one-1'",
            (json.dumps({"role": "assistant", "time": {"completed": 1100}}),),
        )
    assert len(repo.transcripts.capture(session.id)) == 2


def test_unstage_allows_restaging_and_concurrent_capture_does_not_duplicate(capture_repo):
    repo, session, _ = capture_repo
    repo.transcripts.bind(session.id, "one")
    with ThreadPoolExecutor(max_workers=6) as executor:
        results = list(executor.map(lambda _: repo.transcripts.capture(session.id), range(12)))
    assert all(len(result) == 2 for result in results)
    repo.unstage(session.id)
    assert len(repo.transcripts.capture(session.id)) == 2


def test_capture_api_returns_actionable_states_and_immutable_conversation(capture_repo):
    repo, session, _ = capture_repo
    client = TestClient(create_app(repo=repo))
    url = f"/api/v1/sessions/{session.id}/capture"
    assert client.post(url).json()["status"] == "unbound"
    assert client.put(url, json={"native_id": "one"}).json()["status"] == "bound"
    assert client.post(url).json()["status"] == "ready"
    commit = repo.commit_staged(session.id)
    assert [
        item["role"] for item in client.get(f"/api/v1/commits/{commit.id}/conversation").json()
    ] == ["user", "assistant"]


def test_missing_and_unsupported_history_are_distinct(capture_repo):
    _, session, database = capture_repo
    with pytest.raises(CaptureUnavailable) as error:
        opencode_messages("deleted", session.project_path)
    assert error.value.status == "missing"
    with sqlite3.connect(database) as conn:
        conn.execute("DROP TABLE part")
    with pytest.raises(CaptureUnavailable) as error:
        opencode_messages("one", session.project_path)
    assert error.value.status == "unsupported"


def test_nested_transactions_do_not_commit_an_outer_failure(capture_repo):
    repo, session, _ = capture_repo
    repo.transcripts.bind(session.id, "one")
    with pytest.raises(RuntimeError):
        with repo._storage.transaction():
            repo.transcripts.capture(session.id)
            repo.commit_staged(session.id)
            raise RuntimeError("interrupted checkpoint")
    assert repo.staged(session.id) == []
    assert len(repo.transcripts.capture(session.id)) == 2
    assert len(repo.log(session.branch)) == 1


def test_interrupted_response_is_not_saved_as_a_complete_reply(capture_repo):
    repo, session, database = capture_repo
    repo.transcripts.bind(session.id, "one")
    with sqlite3.connect(database) as conn:
        conn.execute(
            "UPDATE message SET data = ? WHERE id = 'one-1'",
            (
                json.dumps(
                    {"role": "assistant", "time": {"completed": 1100}, "error": {"name": "Aborted"}}
                ),
            ),
        )
    with pytest.raises(CaptureUnavailable) as error:
        repo.transcripts.capture(session.id)
    assert error.value.status == "interrupted"
    assert repo.staged(session.id) == []


def test_checkpoint_api_captures_without_a_terminal_screenshot(capture_repo):
    repo, session, _ = capture_repo
    repo.transcripts.bind(session.id, "one")
    client = TestClient(create_app(repo=repo))
    response = client.post(
        f"/api/v1/sessions/{session.id}/commit", json={"summary": "real conversation"}
    )
    assert response.status_code == 200
    assert [message["role"] for message in response.json()["commit"]["messages"]] == [
        "user",
        "assistant",
    ]


def test_first_launch_is_not_blocked_by_a_missing_native_database(capture_repo):
    repo, session, database = capture_repo
    database.unlink()
    client = TestClient(create_app(repo=repo))
    state = client.get(f"/api/v1/sessions/{session.id}/capture").json()
    assert state["status"] == "unbound"
    assert state["discovery_status"] == "missing"
    assert client.post(f"/api/v1/sessions/{session.id}/capture").json()["status"] == "missing"


def test_10000_message_history_pages_are_ordered_and_bounded(capture_repo):
    from contextgit.core.models import Message

    repo, _, _ = capture_repo
    commit = repo.commit(
        [
            Message(role="user" if index % 2 == 0 else "assistant", content=f"message {index}")
            for index in range(10_000)
        ],
        model="test",
    )
    client = TestClient(create_app(repo=repo))
    cursor = 0
    collected = []
    while True:
        page = client.get(
            f"/api/v1/commits/{commit.id}/conversation/page",
            params={"cursor": cursor, "limit": 200},
        ).json()
        assert len(page["messages"]) <= 200
        collected.extend(message["content"] for message in page["messages"])
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert collected == [f"message {index}" for index in range(10_000)]
    assert (
        client.get(f"/api/v1/commits/{commit.id}/conversation/page?limit=10000").status_code == 422
    )
