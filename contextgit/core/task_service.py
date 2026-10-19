"""Standalone task workflow (roadmap Phase 1): create, list, show, start, stop.

A task is a unit of work on the team graph. Its branch, worktree and AgentRun
are not stored on the task: they are read through its linked Session, so the
task never holds a second copy of state that could drift.

A team is created on demand for the repository's project when a standalone task
needs one; projects may have multiple teams.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path

from contextgit.adapters.registry import get_adapter, known_adapters
from contextgit.core.errors import ContextGitError, InvalidTaskTransition
from contextgit.core.lifecycle import assert_transition
from contextgit.core.models import Session, Task, task_phase
from contextgit.core.repo import Repo

# Capability flags shown in the task view, in display order.
_FLAG_CAPABILITIES = ("launch", "transcript", "usage", "structured_review")


@dataclass(frozen=True)
class TaskView:
    id: str
    title: str
    phase: str
    status: str
    agent: str | None
    depends_on: list[str]
    blocked_by: list[str]
    parent_id: str | None
    session_id: str | None
    branch: str | None
    worktree_path: str | None
    agent_run_id: str | None
    # Adapter capabilities for the task's provider. Unsupported flags are
    # listed by name so the view never implies a capability it does not have.
    capabilities: dict[str, bool]
    unsupported: list[str]
    event_kinds: list[str]

    def to_json(self) -> dict[str, object]:
        return asdict(self)


class TaskService:
    def __init__(self, repo: Repo) -> None:
        self._repo = repo

    def _project_path(self) -> str:
        root = self._repo.root
        project = root.parent if root.name == ".contextgit" else root
        return str(project.resolve())

    def _team_id(self) -> str:
        team = self._repo.team_for_project(self._project_path()) or self._repo.current_team()
        if team is None:
            project = Path(self._project_path())
            team = self._repo.create_team(project.name, project_path=str(project))
        return team.id

    def create(
        self,
        title: str,
        *,
        brief: str = "",
        done_criteria: str = "",
        role: str = "implementer",
        agent: str | None = None,
        scope: list[str] | None = None,
        contract: str | None = None,
        depends_on: list[str] | None = None,
        gate_command: str | None = None,
        parent_id: str | None = None,
    ) -> TaskView:
        task = self._repo.create_task(
            self._team_id(),
            title=title,
            brief=brief,
            done_criteria=done_criteria,
            role=role,
            agent=agent,
            scope=scope,
            contract=contract,
            depends_on=depends_on,
            gate_command=gate_command,
            parent_id=parent_id,
        )
        return self._view(self._repo.get_task(task.id))

    def list_tasks(self) -> list[TaskView]:
        teams = self._repo.list_teams(project_path=self._project_path())
        return [
            self._view(task)
            for team in teams
            for task in self._repo.list_tasks(team.id)
        ]

    def show(self, task_id: str) -> TaskView:
        return self._view(self._repo.get_task(task_id))

    def start(self, task_id: str, *, agent: str | None = None) -> TaskView:
        task = self._repo.get_task(task_id)
        phase = task_phase(task)
        if phase == "RUNNING":
            # Idempotent, but a different provider cannot take over a live run.
            if agent is not None and agent != (task.agent or "terminal"):
                raise ContextGitError(
                    f"task is already running on {task.agent or 'terminal'}; "
                    f"cannot start it with {agent}"
                )
            return self._view(task)
        if phase not in {"READY", "BLOCKED"}:
            raise InvalidTaskTransition(f"cannot start a task in phase {phase}")
        if agent is not None and agent not in {a.id for a in known_adapters()}:
            known = ", ".join(a.id for a in known_adapters())
            raise ContextGitError(f"unknown agent '{agent}' (known: {known})")
        # BLOCKED goes through the repo, which reports the unfinished dependencies by name.
        return self._view(self._repo.start_task(task_id, agent=agent))

    def retry(self, task_id: str, *, agent: str | None = None) -> TaskView:
        """Restart a stopped task: FAILED -> READY, then start it again."""
        task = self._repo.get_task(task_id)
        assert_transition(task_phase(task), "READY")
        self._repo.reset_task(task_id)
        return self.start(task_id, agent=agent)

    def stop(self, task_id: str, note: str = "stopped by user") -> TaskView:
        task = self._repo.get_task(task_id)
        assert_transition(task_phase(task), "FAILED")
        return self._view(self._repo.stop_task(task_id, note))

    def events(self, task_id: str) -> list[dict[str, object]]:
        return [event.model_dump(mode="json") for event in self._repo.agent_events(task_id)]

    def _view(self, task: Task) -> TaskView:
        session = self._session(task.session_id)
        run = self._repo.agent_run_for_session(task.session_id) if task.session_id else None
        # A terminal task with no provider is launched as a generic terminal session.
        adapter = get_adapter(task.agent or "terminal")
        caps = adapter.capabilities
        return TaskView(
            id=task.id,
            title=task.title,
            phase=task_phase(task),
            status=task.status,
            agent=task.agent,
            depends_on=list(task.depends_on),
            blocked_by=list(task.blocked_by),
            parent_id=task.parent_id,
            session_id=task.session_id,
            branch=session.git_branch if session else None,
            worktree_path=session.worktree_path if session else None,
            agent_run_id=run.id if run else None,
            capabilities={name: getattr(caps, name) for name in _FLAG_CAPABILITIES},
            unsupported=[name for name in _FLAG_CAPABILITIES if not getattr(caps, name)],
            event_kinds=sorted(caps.event_kinds),
        )

    def _session(self, session_id: str | None) -> Session | None:
        if not session_id:
            return None
        try:
            return self._repo.get_session(session_id)
        except ContextGitError:
            return None  # the session was deleted; the task keeps its history
