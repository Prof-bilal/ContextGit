"""Task-graph logic for team mode: what can start, what is blocked, what order.

Pure functions over tasks and their dependency edges — no storage, no git, no
API. `Repo` owns the wiring; this module owns the reasoning about the graph so
the coordinator stays thin and the rules are testable in isolation.
"""

from __future__ import annotations

from contextgit.core.errors import TaskCycleError
from contextgit.core.models import Task, TaskStatus

# Board order: the way a board reads left to right.
STATUS_ORDER: tuple[TaskStatus, ...] = ("todo", "blocked", "working", "review", "done", "failed")

# Message kinds the team board accepts.
TEAM_MESSAGE_KINDS: tuple[str, ...] = (
    "update",
    "question",
    "answer",
    "handoff",
    "contract",
    "review",
    "gate",
    "system",
)


def blocked_by(task_id: str, tasks: dict[str, Task], deps: dict[str, list[str]]) -> list[str]:
    """Dependencies of `task_id` that are not `done` yet.

    An empty list means the task is ready to start.
    """
    return sorted(dep for dep in deps.get(task_id, []) if tasks[dep].status != "done")


def is_ready(task_id: str, tasks: dict[str, Task], deps: dict[str, list[str]]) -> bool:
    """True when every dependency of `task_id` is already done."""
    return not blocked_by(task_id, tasks, deps)


def dependents(deps: dict[str, list[str]], task_id: str) -> list[str]:
    """Task ids that directly depend on `task_id`."""
    return sorted(task for task, needs in deps.items() if task_id in needs)


def validate_graph(task_ids: list[str], deps: dict[str, list[str]]) -> None:
    """Raise `TaskCycleError` for unknown dependency ids or a cycle.

    Call this before persisting an edge so a bad graph can never be stored.
    """
    known = set(task_ids)
    for task_id, needs in deps.items():
        for need in needs:
            if need not in known:
                raise TaskCycleError(f"task '{task_id[:12]}' depends on unknown task '{need[:12]}'")
            if need == task_id:
                raise TaskCycleError(f"task '{task_id[:12]}' cannot depend on itself")
    topological_order(task_ids, deps)


def topological_order(task_ids: list[str], deps: dict[str, list[str]]) -> list[str]:
    """A dependency-respecting order of tasks; raises on a cycle (Kahn's algorithm).

    Ties are broken by the input order (plan order), never by id — ids are
    random, so sorting them would launch independent tasks in a random order.
    """
    known = set(task_ids)
    indegree = {task_id: 0 for task_id in task_ids}
    edges: dict[str, list[str]] = {task_id: [] for task_id in task_ids}
    for task_id, needs in deps.items():
        if task_id not in known:
            continue
        for need in needs:
            if need not in known:
                raise TaskCycleError(f"task '{task_id[:12]}' depends on unknown task '{need[:12]}'")
            indegree[task_id] += 1
            edges[need].append(task_id)

    ready = [task_id for task_id in task_ids if indegree[task_id] == 0]
    order: list[str] = []
    while ready:
        current = ready.pop(0)
        order.append(current)
        for follower in edges[current]:
            indegree[follower] -= 1
            if indegree[follower] == 0:
                ready.append(follower)

    if len(order) != len(task_ids):
        raise TaskCycleError("task dependencies form a cycle")
    return order


def columns(tasks: list[Task]) -> dict[TaskStatus, list[Task]]:
    """Group tasks by status for the board, keeping each column in task order."""
    board: dict[TaskStatus, list[Task]] = {status: [] for status in STATUS_ORDER}
    for task in sorted(tasks, key=lambda item: (item.position, item.created_at)):
        board[task.status].append(task)
    return board
