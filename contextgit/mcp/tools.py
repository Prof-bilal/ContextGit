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
from contextgit.core.models import Task, TeamBoard
from contextgit.core.repo import Repo
from contextgit.endpoints.discover import discover
from contextgit.endpoints.provenance import graph_with_provenance
from contextgit.endpoints.staleness import annotate
from contextgit.endpoints.tests import remembered
from contextgit.endpoints.why import why_for
from contextgit.gitops.globs import globs_overlap
from contextgit.llm.base import LLMProvider
from contextgit.llm.registry import build_for
from contextgit.memory.bundle import memory_for

ResultT = TypeVar("ResultT")

# The run's own task, injected into its terminal environment by the app.
TASK_ENV = "CONTEXTGIT_TASK"
# Where the repository lives, matching the API/CLI convention.
REPO_ENV = "CONTEXTGIT_REPO"
TEAM_ENV = "CONTEXTGIT_TEAM"
ROLE_ENV = "CONTEXTGIT_ROLE"


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


def current_team_id(repo: Repo) -> str | None:
    """Resolve the caller's team without falling back across team boundaries."""
    explicit = os.getenv(TEAM_ENV)
    if explicit:
        return explicit
    task_id = current_task_id()
    if task_id:
        try:
            return repo.get_task(task_id).team_id
        except ContextGitError:
            return None
    team = repo.current_team()
    return team.id if team else None


def _board(repo: Repo) -> TeamBoard | None:
    team_id = current_team_id(repo)
    return repo.team_board(team_id) if team_id else None


def _task_permission(repo: Repo, task_id: str) -> dict[str, Any] | None:
    scoped = os.getenv(TEAM_ENV)
    own_task = current_task_id()
    if scoped and repo.get_task(task_id).team_id != scoped:
        return {"error": "The task belongs to another team", "type": "Forbidden"}
    if own_task and task_id != own_task and os.getenv(ROLE_ENV) != "orchestrator":
        return {"error": "Workers can only modify their assigned task", "type": "Forbidden"}
    return None


def _orchestrator_team(
    repo: Repo, team_id: str | None = None
) -> tuple[str | None, dict[str, Any] | None]:
    """Authorize an orchestrator-only operation and pin it to its own team."""
    resolved = team_id or current_team_id(repo)
    role = os.getenv(ROLE_ENV)
    if role != "orchestrator":
        return None, {
            "error": "this tool is restricted to the team orchestrator",
            "type": "Forbidden",
        }
    scoped = os.getenv(TEAM_ENV)
    if not scoped or not resolved or scoped != resolved:
        return None, {
            "error": "the requested team is outside this orchestrator session",
            "type": "Forbidden",
        }
    try:
        repo.get_team(resolved)
    except ContextGitError as exc:
        return None, {"error": str(exc), "type": type(exc).__name__}
    return resolved, None


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
        "dependency_ids": task.depends_on,
        "brief": task.brief,
        "done_criteria": task.done_criteria,
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
    board = _board(repo)
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
    board = _board(repo)
    if board is None:
        return []
    titles = {task.id: task.title for task in board.tasks}
    tasks = board.tasks
    if status:
        tasks = [task for task in tasks if task.status == status]
    return [_task_view(task, titles) for task in tasks]


def read_board(repo: Repo, since: int | None = None, limit: int = 20) -> list[dict[str, Any]]:
    """Recent board messages; pass the last id you saw to get only newer ones."""
    board = _board(repo)
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
    error = _task_permission(repo, resolved)
    if error:
        return error
    return _guard(lambda: _task_view(repo.start_task(resolved), _titles(repo)))


def finish_task(repo: Repo, task_id: str | None = None, evidence: str = "") -> dict[str, Any]:
    """Mark your task complete; its quality gate runs and it lands in review."""
    resolved = task_id or current_task_id()
    if not resolved:
        return {"error": f"no task given and ${TASK_ENV} is unset", "type": "NoTask"}
    error = _task_permission(repo, resolved)
    if error:
        return error

    def run() -> dict[str, Any]:
        if evidence:
            team_id = resolved_team(repo, resolved)
            repo.post_message(team_id, evidence, kind="update", task_id=resolved)
        return _task_view(repo.complete_task(resolved), _titles(repo))

    return _guard(run)


def post_update(repo: Repo, text: str, task_id: str | None = None) -> dict[str, Any]:
    """Post a line to the team board so the other runs can read it."""
    resolved = task_id or current_task_id()
    if resolved:
        error = _task_permission(repo, resolved)
        if error:
            return error
    board = _board(repo)
    if board is None:
        return {"error": "no team yet", "type": "TeamNotFound"}
    message = repo.post_message(board.team.id, text, kind="update", task_id=resolved)
    return {"id": message.id, "body": message.body, "kind": message.kind}


def check_ownership(repo: Repo, path: str) -> dict[str, Any]:
    """Which task owns a file path, or whether it is free."""
    board = _board(repo)
    if board is None:
        return {"path": path, "owner": None, "free": True}
    for task in board.tasks:
        if any(globs_overlap(glob, path) for glob in task.scope):
            return {"path": path, "owner": task.title, "task_id": task.id, "free": False}
    return {"path": path, "owner": None, "free": True}


def peers(repo: Repo) -> list[dict[str, Any]]:
    """The other runs: what they own, their status and their latest message."""
    board = _board(repo)
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
    error = _task_permission(repo, resolved)
    if error:
        return error
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
    board = _board(repo)
    return {task.id: task.title for task in board.tasks} if board else {}


# ---------- orchestrator-only team control ----------


def propose_team_plan(
    repo: Repo,
    goal: str,
    tasks: list[dict[str, Any]],
    completion_criteria: list[str] | None = None,
    quality_gates: list[str] | None = None,
    team_id: str | None = None,
) -> dict[str, Any]:
    """Submit a structured plan for user review; this never launches workers."""
    resolved, error = _orchestrator_team(repo, team_id)
    if error or resolved is None:
        return error or {"error": "no team", "type": "TeamNotFound"}
    if not 1 <= len(tasks) <= 12:
        return {"error": "a team plan must contain between 1 and 12 workers", "type": "InvalidPlan"}
    plan = repo.save_team_plan(
        resolved,
        {
            "goal": goal,
            "tasks": tasks,
            "completion_criteria": completion_criteria or [],
            "quality_gates": quality_gates or [],
        },
    )
    return plan.model_dump(mode="json")


def revise_team_plan(
    repo: Repo,
    goal: str,
    tasks: list[dict[str, Any]],
    completion_criteria: list[str] | None = None,
    quality_gates: list[str] | None = None,
    team_id: str | None = None,
) -> dict[str, Any]:
    """Create another immutable plan revision for user review."""
    return propose_team_plan(repo, goal, tasks, completion_criteria, quality_gates, team_id)


def create_or_update_task(
    repo: Repo,
    title: str,
    brief: str = "",
    role: str = "implementer",
    agent: str | None = None,
    scope: list[str] | None = None,
    done_criteria: str = "",
    task_id: str | None = None,
    team_id: str | None = None,
) -> dict[str, Any]:
    resolved, error = _orchestrator_team(repo, team_id)
    if error or resolved is None:
        return error or {"error": "no team", "type": "TeamNotFound"}
    if task_id:
        task = repo.get_task(task_id)
        if task.team_id != resolved:
            return {"error": "task belongs to another team", "type": "Forbidden"}
        task = repo.update_task(
            task_id,
            title=title,
            brief=brief,
            role=role,
            agent=agent,
            scope=scope,
            done_criteria=done_criteria,
        )
    else:
        task = repo.create_task(
            resolved,
            title=title,
            brief=brief,
            role=role,
            agent=agent,
            scope=scope,
            done_criteria=done_criteria,
        )
    return _task_view(task, _titles(repo))


def assign_worker(
    repo: Repo, task_id: str, agent: str, role: str, team_id: str | None = None
) -> dict[str, Any]:
    resolved, error = _orchestrator_team(repo, team_id)
    if error or resolved is None:
        return error or {"error": "no team", "type": "TeamNotFound"}
    task = repo.get_task(task_id)
    if task.team_id != resolved:
        return {"error": "task belongs to another team", "type": "Forbidden"}
    return _task_view(repo.update_task(task_id, agent=agent, role=role), _titles(repo))


def attach_skill(
    repo: Repo,
    skill_id: str,
    title: str,
    instruction: str,
    origin: str = "project",
    task_id: str | None = None,
    agent: str | None = None,
    team_id: str | None = None,
) -> dict[str, Any]:
    resolved, error = _orchestrator_team(repo, team_id)
    if error or resolved is None:
        return error or {"error": "no team", "type": "TeamNotFound"}
    return repo.attach_skill(
        resolved,
        skill_id=skill_id,
        title=title,
        instruction=instruction,
        origin=origin,
        task_id=task_id,
        agent=agent,
    ).model_dump(mode="json")


def review_task(
    repo: Repo,
    task_id: str,
    decision: str,
    note: str = "",
    team_id: str | None = None,
) -> dict[str, Any]:
    if decision not in {"approve", "reject"}:
        return {"error": "Review decision must be approve or reject", "type": "InvalidDecision"}
    resolved, error = _orchestrator_team(repo, team_id)
    if error or resolved is None:
        return error or {"error": "no team", "type": "TeamNotFound"}
    task = repo.get_task(task_id)
    if task.team_id != resolved:
        return {"error": "task belongs to another team", "type": "Forbidden"}
    reviewed = (
        repo.approve_task(task_id)
        if decision == "approve"
        else repo.reject_task(task_id, note or "changes requested")
    )
    return _task_view(reviewed, _titles(repo))


def pause_team(repo: Repo, team_id: str | None = None) -> dict[str, Any]:
    resolved, error = _orchestrator_team(repo, team_id)
    if error or resolved is None:
        return error or {"error": "no team", "type": "TeamNotFound"}
    return repo.update_team_details(resolved, state="paused").model_dump(mode="json")


def resume_team(repo: Repo, team_id: str | None = None) -> dict[str, Any]:
    resolved, error = _orchestrator_team(repo, team_id)
    if error or resolved is None:
        return error or {"error": "no team", "type": "TeamNotFound"}
    repo.update_team_details(resolved, state="running")
    if repo.team_execution.settings(resolved) and repo.latest_team_plan(resolved) and repo.latest_team_plan(resolved).status == "approved":
        repo.team_execution.integrate(resolved)
    else:
        repo.launch_team(resolved)
    return repo.get_team(resolved).model_dump(mode="json")


def prepare_merge(repo: Repo, team_id: str | None = None) -> dict[str, Any]:
    """Report merge readiness. The final merge remains a user-only API action."""
    resolved, error = _orchestrator_team(repo, team_id)
    if error or resolved is None:
        return error or {"error": "no team", "type": "TeamNotFound"}
    if repo.team_execution.settings(resolved):
        return repo.team_execution.preview(resolved)
    tasks = repo.list_tasks(resolved)
    unfinished = [task.title for task in tasks if task.status != "done"]
    if not unfinished and tasks:
        repo.update_team_details(resolved, state="merge_ready")
    return {
        "ready": bool(tasks) and not unfinished,
        "unfinished": unfinished,
        "requires_user_confirmation": True,
    }


def integrate_team(repo: Repo, team_id: str | None = None) -> dict[str, Any]:
    """Parent-only integration into the fixed team branch, never the user's branch."""
    resolved, error = _orchestrator_team(repo, team_id)
    if error or resolved is None:
        return error or {"error": "no team", "type": "TeamNotFound"}
    return _guard(lambda: repo.team_execution.integrate(resolved))


def propose_skill(
    repo: Repo,
    title: str,
    instruction: str,
    evidence: str,
    scope: list[str] | None = None,
    team_id: str | None = None,
) -> dict[str, Any]:
    """Propose, but do not activate, a reusable skill backed by reviewed evidence."""
    resolved, error = _orchestrator_team(repo, team_id)
    if error or resolved is None:
        return error or {"error": "no team", "type": "TeamNotFound"}
    from contextgit.knowledge.skills import SkillDraft, SkillLibrary

    team = repo.get_team(resolved)
    tasks = repo.list_tasks(resolved)
    if not evidence.strip() or not tasks or any(task.status != "done" for task in tasks):
        return {
            "error": "skill proposals require reviewed completed tasks and evidence",
            "type": "InvalidSkill",
        }
    draft = (
        SkillLibrary(team.project_path)
        .propose(
            SkillDraft(
                title=title,
                instruction=instruction,
                evidence=evidence,
                scope=scope or [],
                source_team=resolved,
                source_session=team.orchestrator_session_id,
            )
        )
        .model_dump(mode="json")
    )
    repo.post_message(resolved, f"Skill proposed: {title}\nEvidence: {evidence}", kind="review")
    return draft


# ---------- scoped memory (derived from the runs, never hand-written) ----------


def project_path(repo: Repo) -> Path:
    """The project this agent is working in: its run's project, else the cwd."""
    task_id = current_task_id()
    if task_id:
        try:
            task = repo.get_task(task_id)
            if task.session_id:
                session = repo.get_session(task.session_id)
                if session.project_path:
                    return Path(session.project_path)
        except ContextGitError:
            pass
    return Path.cwd()


def task_scope(repo: Repo) -> list[str]:
    """The paths this agent claims — the scope memory is answered for."""
    task_id = current_task_id()
    if not task_id:
        return []
    try:
        task = repo.get_task(task_id)
    except ContextGitError:
        return []
    if task.scope:
        return list(task.scope)
    return [task.contract] if task.contract else []


def memory_provider(repo: Repo) -> LLMProvider | None:
    """A provider for extractions, if the app has one configured. May be None."""
    try:
        records = repo.list_providers()
    except ContextGitError:
        return None
    for record in records:
        try:
            adapter, _ = build_for(record.id, records)
            return adapter
        except Exception:  # noqa: BLE001 — try the next configured provider
            continue
    return None


def _resolve_paths(repo: Repo, path: str | None) -> tuple[list[str], str]:
    if path:
        return [path], "the path you named"
    scope = task_scope(repo)
    if scope:
        return scope, "your task's scope"
    return [], "no scope"


def memory(repo: Repo, path: str | None = None) -> dict[str, Any]:
    """What the recorded runs decided — and rejected — for these files."""
    patterns, how = _resolve_paths(repo, path)
    if not patterns:
        return {
            "note": (
                "I have no scope to answer for. Pass a path, or start me from a "
                "task that claims one."
            )
        }
    bundle = memory_for(repo, memory_provider(repo), project_path(repo), patterns, scoped_by=how)
    return bundle.model_dump(mode="json")


def dead_ends(repo: Repo, path: str | None = None) -> dict[str, Any]:
    """Approaches already rejected for these files — do not retry them blindly."""
    patterns, how = _resolve_paths(repo, path)
    if not patterns:
        return {"note": "No scope to answer for; pass a path.", "dead_ends": []}
    bundle = memory_for(repo, memory_provider(repo), project_path(repo), patterns, scoped_by=how)
    return {
        "scoped_by": how,
        "files": bundle.files,
        "dead_ends": bundle.dead_ends,
        "note": bundle.note,
    }


def decisions(repo: Repo, path: str | None = None) -> dict[str, Any]:
    """The decisions the recorded runs made about these files, and why."""
    patterns, how = _resolve_paths(repo, path)
    if not patterns:
        return {"note": "No scope to answer for; pass a path.", "decisions": []}
    bundle = memory_for(repo, memory_provider(repo), project_path(repo), patterns, scoped_by=how)
    return {
        "scoped_by": how,
        "files": bundle.files,
        "decisions": bundle.decisions,
        "open_questions": bundle.open_questions,
        "runs": [
            {"run": run.run_name or run.run_id, "agent": run.agent, "files": run.files}
            for run in bundle.runs
        ],
        "note": bundle.note,
    }


def why_line(
    repo: Repo, path: str, line: int | None = None, as_of: str | None = None
) -> dict[str, Any]:
    """Why this file (or line) exists: the reasoning behind the change that made it."""
    answer = why_for(
        repo,
        memory_provider(repo),
        project_path(repo),
        path,
        line=line,
        as_of=as_of,
    )
    return answer.model_dump(mode="json")


def endpoints(repo: Repo, path: str | None = None) -> dict[str, Any]:
    """The endpoints of this project, each with the run that introduced it."""
    project = project_path(repo)
    graph = discover(project)
    items = []
    for endpoint in graph.endpoints:
        if path and not globs_overlap(path, endpoint.source.file or ""):
            continue
        items.append(
            {
                "id": endpoint.id,
                "method": endpoint.method,
                "path": endpoint.path,
                "handler": (
                    f"{endpoint.source.file}:{endpoint.source.line}"
                    if endpoint.source.file
                    else None
                ),
                "confidence": endpoint.source.confidence,
                "auth": endpoint.auth,
            }
        )
    return {"project_path": str(project), "count": len(items), "endpoints": items}


def endpoint_tests(repo: Repo, path: str | None = None) -> dict[str, Any]:
    """The generated API tests for this project, and whether they are still true."""
    project = project_path(repo)
    suite = annotate(project, remembered(project), graph_with_provenance(repo, project))
    files = [
        {
            "endpoint": item.endpoint_id,
            "file": item.file,
            "status": item.status,
            "state": item.state,
            "reason": item.reason,
        }
        for item in suite.files
        if not path or globs_overlap(path, item.file)
    ]
    return {
        "project_path": str(project),
        "passed": suite.passed,
        "failed": suite.failed,
        "stale": suite.stale,
        "retired": suite.retired,
        "files": files,
    }
