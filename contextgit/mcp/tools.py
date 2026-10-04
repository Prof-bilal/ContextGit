"""The team operations an agent can call — plain functions over Repo.

No MCP SDK here: these are ordinary functions so they can be tested, called
from the CLI, or wrapped by any transport. `server.py` is only the binding.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from pathlib import Path
from typing import Any, TypeVar

from contextgit.core.errors import ContextGitError, RepoNotFound
from contextgit.core.models import Task
from contextgit.core.repo import Repo
from contextgit.gitops.globs import globs_overlap

ResultT = TypeVar("ResultT")

# The run's own task, injected into its terminal environment by the app.
TASK_ENV = "CONTEXTGIT_TASK"
# Where the repository lives, matching the API/CLI convention.
REPO_ENV = "CONTEXTGIT_REPO"


def open_repo(repo_path: str | None = None) -> Repo:
    """Open (or initialise) the repository the tools operate on."""
    path = Path(repo_path or os.getenv(REPO_ENV) or ".contextgit")
    try:
        return Repo.open(path)
    except RepoNotFound:
        return Repo.init(path)


def current_task_id() -> str | None:
    """The task this agent was started for, when the app launched it."""
    return os.getenv(TASK_ENV) or None


def _task_view(task: Task, titles: dict[str, str]) -> dict[str, Any]:
    return {
        "id": task.id,
        "title": task.title,
        "status": task.status,
        "role": task.role,
        "agent": task.agent,
        "scope": task.scope,
        "contract": task.contract,
        "depends_on": [titles.get(dep, dep) for dep in task.depends_on],
        "blocked_by": [titles.get(dep, dep) for dep in task.blocked_by],
        "tokens": task.tokens,
        "gate_status": task.gate_status,
    }


def _guard(call: Callable[[], ResultT]) -> ResultT | dict[str, Any]:
    """Turn a domain error into a readable result instead of a transport error."""
    try:
        return call()
    except ContextGitError as exc:
        return {"error": str(exc), "type": type(exc).__name__}


def team_status(repo: Repo) -> dict[str, Any]:
    """Counts, blockers and what is waiting on review."""
    board = repo.team_board()
    if board is None:
        return {"team": None, "hint": "no team yet — create one in the Code tab"}
    tasks = board.tasks
    counts: dict[str, int] = {}
    for task in tasks:
        counts[task.status] = counts.get(task.status, 0) + 1
    return {
        "team": board.team.name,
        "project_path": board.team.project_path,
        "base_ref": board.team.base_ref,
        "gate_command": board.team.gate_command,
        "current_branch": board.current_branch,
        "counts": counts,
        "blocked": [
            {"title": task.title, "waiting_on": task.blocked_by}
            for task in tasks
            if task.status == "blocked"
        ],
        "in_review": [task.title for task in tasks if task.status == "review"],
        "your_task": current_task_id(),
    }


def list_tasks(repo: Repo, status: str | None = None) -> list[dict[str, Any]]:
    """Every task (or just one status), with its owner, scope and dependencies."""
    board = repo.team_board()
    if board is None:
        return []
    titles = {task.id: task.title for task in board.tasks}
    tasks = board.tasks
    if status:
        tasks = [task for task in tasks if task.status == status]
    return [_task_view(task, titles) for task in tasks]


def read_board(repo: Repo, since: int | None = None, limit: int = 20) -> list[dict[str, Any]]:
    """Recent board messages; pass the last id you saw to get only newer ones."""
    board = repo.team_board()
    if board is None:
        return []
    titles = {task.id: task.title for task in board.tasks}
    messages = board.messages
    if since is not None:
        messages = [message for message in messages if message.id > since]
    return [
        {
            "id": message.id,
            "kind": message.kind,
            "from": titles.get(message.from_task_id or message.task_id or "", "team"),
            "body": message.body,
            "at": message.created_at.isoformat(),
        }
        for message in messages[-limit:]
    ]


def start_task(repo: Repo, task_id: str | None = None) -> dict[str, Any]:
    """Claim and start a task (your own by default)."""
    resolved = task_id or current_task_id()
    if not resolved:
        return {"error": f"no task given and ${TASK_ENV} is unset", "type": "NoTask"}
    return _guard(lambda: _task_view(repo.start_task(resolved), _titles(repo)))


def finish_task(repo: Repo, task_id: str | None = None, evidence: str = "") -> dict[str, Any]:
    """Mark your task complete; its quality gate runs and it lands in review."""
    resolved = task_id or current_task_id()
    if not resolved:
        return {"error": f"no task given and ${TASK_ENV} is unset", "type": "NoTask"}

    def run() -> dict[str, Any]:
        if evidence:
            team_id = resolved_team(repo, resolved)
            repo.post_message(team_id, evidence, kind="update", task_id=resolved)
        return _task_view(repo.complete_task(resolved), _titles(repo))

    return _guard(run)


def post_update(repo: Repo, text: str, task_id: str | None = None) -> dict[str, Any]:
    """Post a line to the team board so the other runs can read it."""
    resolved = task_id or current_task_id()
    board = repo.team_board()
    if board is None:
        return {"error": "no team yet", "type": "TeamNotFound"}
    message = repo.post_message(board.team.id, text, kind="update", task_id=resolved)
    return {"id": message.id, "body": message.body, "kind": message.kind}


def check_ownership(repo: Repo, path: str) -> dict[str, Any]:
    """Which task owns a file path, or whether it is free."""
    board = repo.team_board()
    if board is None:
        return {"path": path, "owner": None, "free": True}
    for task in board.tasks:
        if any(globs_overlap(glob, path) for glob in task.scope):
            return {"path": path, "owner": task.title, "task_id": task.id, "free": False}
    return {"path": path, "owner": None, "free": True}


def peers(repo: Repo) -> list[dict[str, Any]]:
    """The other runs: what they own, their status and their latest message."""
    board = repo.team_board()
    if board is None:
        return []
    titles = {task.id: task.title for task in board.tasks}
    mine = current_task_id()
    latest: dict[str, str] = {}
    for message in board.messages:
        if message.task_id:
            latest[message.task_id] = message.body
    return [
        {
            **_task_view(task, titles),
            "latest": latest.get(task.id, ""),
        }
        for task in board.tasks
        if task.id != mine and (task.session_id or task.verifier_session_id)
    ]


def publish_contract(repo: Repo, path: str, task_id: str | None = None) -> dict[str, Any]:
    """Declare the interface file your task owns (exactly one owner)."""
    resolved = task_id or current_task_id()
    if not resolved:
        return {"error": f"no task given and ${TASK_ENV} is unset", "type": "NoTask"}
    task = repo.get_task(resolved)
    scope = list(task.scope)
    if path not in scope:
        scope.append(path)
    return _guard(
        lambda: _task_view(repo.update_task(resolved, contract=path, scope=scope), _titles(repo))
    )


def resolved_team(repo: Repo, task_id: str) -> str:
    """The team a task belongs to."""
    return repo.get_task(task_id).team_id


def _titles(repo: Repo) -> dict[str, str]:
    board = repo.team_board()
    return {task.id: task.title for task in board.tasks} if board else {}
