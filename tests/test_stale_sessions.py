"""Stale terminal sessions from a previous launch reset to idle."""

from pathlib import Path

from contextgit.api.projects import reset_stale_terminals
from contextgit.core.repo import Repo


def test_reset_stale_terminals_only_touches_running_terminals(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / ".contextgit")
    running = repo.create_session("leftover run", kind="terminal")
    repo.set_session_status(running.id, "running")
    done = repo.create_session("finished run", kind="terminal")
    repo.set_session_status(done.id, "done")
    chat = repo.create_session("chatty", kind="chat")
    repo.set_session_status(chat.id, "running")

    assert reset_stale_terminals(repo) == 1
    assert repo.get_session(running.id).status == "idle"
    assert repo.get_session(done.id).status == "done"
    assert repo.get_session(chat.id).status == "running"
