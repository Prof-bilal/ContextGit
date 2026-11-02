"""Parent-led teams: approval-bound scheduling and isolated integration branches."""
from __future__ import annotations

import os
from pathlib import Path
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from contextgit.core.errors import InvalidTaskTransition, TaskNotReviewable
from contextgit.core.cli_models import TEAM_CLIS, validate_model
from contextgit.core.team import validate_graph
from contextgit.gitops.globs import any_overlap
from contextgit.gitops.repo import Git
from contextgit.gitops.spatial import uncommitted_code
from contextgit.integration.service import project_lock
from contextgit.verify import run_command

if TYPE_CHECKING:
    from contextgit.core.repo import Repo
    from contextgit.core.models import TeamPlanRevision


class TeamExecution:
    def __init__(self, repo: Repo):
        self.repo = repo
        self.storage = repo._storage

    def settings(self, team_id: str) -> dict[str, Any] | None:
        return self.storage.team_execution(team_id)

    def environment(self, team_id: str) -> dict[str, str]:
        env = dict(os.environ)
        venv = Path(self.repo.get_team(team_id).project_path) / ".venv"
        binaries = venv / ("Scripts" if os.name == "nt" else "bin")
        if binaries.is_dir():
            env["VIRTUAL_ENV"] = str(venv)
            env["PATH"] = str(binaries) + os.pathsep + env.get("PATH", "")
        return env

    def configure(self, team_id: str, max_active: int, allowed_agents: list[str],
                  orchestrator_model: str | None = None, worker_models: dict[str, str] | None = None) -> None:
        team = self.repo.get_team(team_id)
        git = Git(team.project_path)
        if not git.is_repo():
            raise InvalidTaskTransition("Parent-led teams require a Git project with an initial commit")
        if team.orchestrator_agent not in TEAM_CLIS or not 1 <= max_active <= 12 or not allowed_agents or any(agent not in TEAM_CLIS for agent in allowed_agents):
            raise InvalidTaskTransition("Choose 1–12 active workers and supported team CLIs")
        try:
            validate_model(orchestrator_model)
            for agent, model in (worker_models or {}).items():
                if agent not in allowed_agents:
                    raise ValueError("Worker models must belong to an allowed CLI")
                validate_model(model)
        except ValueError as exc:
            raise InvalidTaskTransition(str(exc)) from exc
        git.rev_parse(team.base_ref or "HEAD")
        branch = f"codex/team/{team.id}"
        git.run("branch", branch, team.base_ref or "HEAD")
        self.storage.save_team_execution(team.id, {"max_active": max_active, "allowed_agents": allowed_agents, "integration_branch": branch,
            "orchestrator_model": orchestrator_model, "worker_models": worker_models or {}})

    def instruction(self, team_id: str) -> str:
        team = self.repo.get_team(team_id)
        settings = self.settings(team_id) or {}
        skills = "\n\n".join(f"## {link.title}\n{link.instruction}" for link in self.repo.team_skills(team_id) if link.task_id is None)
        return (
            f"Allowed worker CLIs: {', '.join(settings.get('allowed_agents', ['codex', 'claude']))}. "
            f"User-selected worker models: {settings.get('worker_models', {})}; unspecified models use the CLI default.\n"
            f'You are the parent orchestrator of team "{team.name}". Goal: {team.goal}\n'
            "First call team_status and list_tasks. If approved workers already exist, resume coordination instead of replacing them. "
            "Inspect this project before proposing a plan. Decide how many workers the task needs (1–12), rather than using a fixed count. "
            f"Use only these worker CLIs: {', '.join(settings.get('allowed_agents', ['codex', 'claude']))}. "
            "Call propose_team_plan with each worker's unique id, title, agent, role, brief, disjoint scope file patterns, depends_on worker IDs, "
            "done_criteria, and relevant skill IDs. Explain your reasoning and team completion criteria. Wait for USER approval; never launch an unapproved worker. "
            "Monitor team_status, list_tasks and read_board. Workers must commit their changes and call complete_task with evidence. "
            "Review their diffs and checks; call review_task to approve or request changes. Approval automatically integrates clean, checked commits "
            f"into {settings.get('integration_branch', 'the team integration branch')}. Dependents start only after integration. "
            "If integration is blocked, inspect the retained candidate and use integrate_team to retry after correction. Do not merge into main or push. "
            "To add workers, propose a full revised plan using the existing task IDs and unchanged approved task fields; append new workers and wait for approval. "
            "Use post_update for progress and blockers. Stay available to coordinate until all work is integrated.\n\n"
            f"Approved skill snapshots:\n{skills}"
        )

    def validate(self, team_id: str, tasks: list[dict[str, Any]]) -> None:
        settings = self.settings(team_id)
        if not settings:
            return
        keys = [str(task.get("id") or f"task-{i + 1}") for i, task in enumerate(tasks)]
        if len(keys) != len(set(keys)):
            raise InvalidTaskTransition("Worker IDs must be unique")
        for task in tasks:
            if not all(str(task.get(field) or "").strip() for field in ("title", "role", "brief", "done_criteria")) or not task.get("scope"):
                raise InvalidTaskTransition("Each worker needs a title, role, instructions, file ownership and completion criteria")
            if task.get("agent") not in settings["allowed_agents"]:
                raise InvalidTaskTransition("Every worker CLI must be in the team's allowed list")
            if not isinstance(task["scope"], list) or any(not isinstance(path, str) or not path.strip() for path in task["scope"]):
                raise InvalidTaskTransition("File ownership must contain non-empty patterns")
            gate = task.get("gate_command")
            if gate and gate != self.repo.get_team(team_id).gate_command:
                raise InvalidTaskTransition("Worker gates must match the project quality gate")
        deps = {key: task.get("depends_on", []) for key, task in zip(keys, tasks, strict=True)}
        if any(not isinstance(values, list) or any(dep not in keys for dep in values) for values in deps.values()):
            raise InvalidTaskTransition("Every dependency must name a worker in the plan")
        validate_graph(keys, deps)
        for i, first in enumerate(tasks):
            for second in tasks[i + 1:]:
                if any_overlap(first["scope"], second["scope"]):
                    raise InvalidTaskTransition("Workers must have disjoint file ownership")

    def normalise(self, team_id: str, plan: TeamPlanRevision, bindings: dict[str, str]) -> None:
        for i, item in enumerate(plan.plan["tasks"]):
            key = str(item.get("id") or f"task-{i + 1}")
            item["id"] = bindings[key]
            item["depends_on"] = [bindings[dep] for dep in item.get("depends_on", [])]
        self.storage.update_team_plan(plan)

    def approve_amendment(self, team_id: str, plan: TeamPlanRevision) -> TeamPlanRevision:
        existing = {task.id: task for task in self.repo.list_tasks(team_id)}
        raw = plan.plan["tasks"]
        proposed = {item["id"]: item for item in raw}
        if not existing.keys() <= proposed.keys():
            raise InvalidTaskTransition("An amendment cannot remove existing workers")
        fields = ("title", "agent", "role", "brief", "scope", "depends_on", "done_criteria")
        for task_id, task in existing.items():
            if any(proposed[task_id].get(field, [] if field in {"scope", "depends_on"} else "") != getattr(task, field) for field in fields):
                raise InvalidTaskTransition("Keep existing approved workers unchanged; append new workers to this plan")
        bindings = {key: key for key in existing}
        for item in raw:
            if item["id"] in existing:
                continue
            task = self.repo.create_task(team_id, title=item["title"], agent=item["agent"], role=item["role"], brief=item["brief"], scope=item["scope"], done_criteria=item["done_criteria"], gate_command=item.get("gate_command"))
            bindings[item["id"]] = task.id
        for item in raw:
            if item["id"] not in existing:
                self.repo.set_task_deps(bindings[item["id"]], [bindings[dep] for dep in item.get("depends_on", [])])
        plan.status = "approved"
        self.normalise(team_id, plan, bindings)
        return plan

    def base_for(self, team_id: str, task_id: str) -> str:
        settings = self.settings(team_id)
        assert settings is not None
        task = self.repo.get_task(task_id)
        plan = self.repo.latest_team_plan(team_id)
        if not plan or plan.status != "approved" or task_id not in {item.get("id") for item in plan.plan["tasks"]}:
            raise InvalidTaskTransition("The user must approve this worker in the team plan")
        approved = next(item for item in plan.plan["tasks"] if item.get("id") == task_id)
        for field in ("agent", "role", "brief", "scope", "done_criteria", "depends_on"):
            if approved.get(field, [] if field in {"scope", "depends_on"} else "") != getattr(task, field):
                raise InvalidTaskTransition("Worker instructions changed after approval; restore the approved plan")
        records = {row["task_id"]: row for row in self.storage.team_integrations(team_id)}
        if any(records.get(dep, {}).get("status") != "integrated" for dep in task.depends_on):
            raise InvalidTaskTransition("Worker dependencies must be integrated before launch")
        return Git(self.repo.get_team(team_id).project_path).rev_parse(settings["integration_branch"])

    def integrate(self, team_id: str) -> dict[str, Any]:
        team = self.repo.get_team(team_id)
        settings = self.settings(team_id)
        if not settings:
            raise InvalidTaskTransition("This team uses the legacy user-confirmed merge workflow")
        with project_lock(team.project_path):
            team = self.repo.get_team(team_id)
            if team.state == "paused":
                raise InvalidTaskTransition("Resume the team before integrating")
            plan = self.repo.latest_team_plan(team_id)
            if not plan or plan.status != "approved":
                raise InvalidTaskTransition("Approve the current plan before integration")
            git = Git(team.project_path)
            records = {row["task_id"]: row for row in self.storage.team_integrations(team_id)}
            for task in self.repo.list_tasks(team_id):
                if task.status != "done" or not task.session_id:
                    continue
                session = self.repo.get_session(task.session_id)
                if not session.worktree_path:
                    raise TaskNotReviewable("Worker has no isolated worktree")
                worker_git = Git(session.worktree_path)
                head = worker_git.rev_parse("HEAD")
                old = records.get(task.id, {})
                if old.get("status") == "integrated":
                    if old.get("worker_head") != head:
                        raise TaskNotReviewable("An integrated worker changed after review; request a new approved task")
                    continue
                record: dict[str, Any] = {"task_id": task.id, "worker_head": head, "status": "blocked"}
                try:
                    if uncommitted_code(session.worktree_path):
                        raise TaskNotReviewable("Commit all implementation files before integration")
                    command = self.repo._gate_command_for(task, team, session.worktree_path)
                    if not command:
                        raise TaskNotReviewable("Automatic team integration requires a project quality gate")
                    checked = run_command(command, session.worktree_path, env=self.environment(team_id))
                    if not checked.ok:
                        raise TaskNotReviewable(f"Worker checks failed: {checked.output[-4000:]}")
                    if head != worker_git.rev_parse("HEAD") or uncommitted_code(session.worktree_path):
                        raise TaskNotReviewable("Worker changed while checks ran; commit and resubmit")
                    base = git.rev_parse(settings["integration_branch"])
                    candidate = Path(team.project_path) / ".contextgit" / "worktrees" / f"integration-{uuid4().hex}"
                    candidate.parent.mkdir(parents=True, exist_ok=True)
                    git.run("worktree", "add", "--detach", str(candidate), base)
                    record["candidate_path"] = str(candidate)
                    candidate_git = Git(candidate)
                    candidate_git.run("merge", "--no-ff", "--no-commit", head)
                    result = run_command(command, str(candidate), env=self.environment(team_id))
                    record["checks"] = result.output[-8000:]
                    if not result.ok:
                        raise TaskNotReviewable("Combined checks failed; inspect the retained integration candidate")
                    if candidate_git.run("ls-files", "-u").stdout:
                        raise TaskNotReviewable("Integration has unresolved conflicts")
                    # Tests must not silently contribute source changes to the merge.
                    if candidate_git.run("diff", "--name-only").stdout.strip():
                        raise TaskNotReviewable("Combined checks modified tracked files; inspect the candidate")
                    if (candidate / ".git").exists() and candidate_git.run("rev-parse", "-q", "--verify", "MERGE_HEAD", check=False).returncode == 0:
                        candidate_git.run("commit", "-m", f"Integrate {task.title} ({team.name})")
                    integrated_head = candidate_git.rev_parse("HEAD")
                    if self.repo.get_team(team_id).state == "paused":
                        raise InvalidTaskTransition("Integration paused before branch promotion")
                    if worker_git.rev_parse("HEAD") != head or uncommitted_code(session.worktree_path):
                        raise TaskNotReviewable("Worker changed during integration; candidate retained")
                    git.run("update-ref", f"refs/heads/{settings['integration_branch']}", integrated_head, base)
                    record.update(status="integrated", integration_head=integrated_head)
                    self.storage.save_team_integration(team_id, task.id, record)
                    self.repo.post_message(team_id, f"Integrated {task.title} into {settings['integration_branch']} at {integrated_head[:10]}; checks passed", kind="review", task_id=task.id)
                except Exception as error:
                    record["error"] = str(error)
                    self.storage.save_team_integration(team_id, task.id, record)
                    self.repo.post_message(team_id, f"Integration blocked: {error}", kind="review", task_id=task.id)
                    raise TaskNotReviewable(str(error)) from error
            self.repo.launch_team(team_id)
            records = self.storage.team_integrations(team_id)
            tasks = self.repo.list_tasks(team_id)
            if tasks and all(any(row["task_id"] == task.id and row["status"] == "integrated" for row in records) for task in tasks):
                self.repo.update_team_details(team_id, state="merge_ready")
            return {**settings, "integrations": records}

    def preview(self, team_id: str) -> dict[str, Any]:
        team = self.repo.get_team(team_id)
        settings = self.settings(team_id)
        assert settings is not None
        tasks = self.repo.list_tasks(team_id)
        records = {row["task_id"]: row for row in self.storage.team_integrations(team_id)}
        unfinished = []
        plan = self.repo.latest_team_plan(team_id)
        if not plan or plan.status != "approved":
            unfinished.append("Approve the latest plan")
        for task in tasks:
            row = records.get(task.id, {})
            if task.status != "done" or row.get("status") != "integrated":
                unfinished.append(f"{task.title}: {row.get('error', 'awaiting parent review and integration')}")
            elif task.session_id:
                session = self.repo.get_session(task.session_id)
                if session.worktree_path and (uncommitted_code(session.worktree_path) or Git(session.worktree_path).rev_parse("HEAD") != row.get("worker_head")):
                    unfinished.append(f"{task.title}: work changed after review")
        git = Git(team.project_path)
        diff = git.run("diff", "--name-status", f"{team.base_ref}...{settings['integration_branch']}").stdout
        files = [{"status": parts[0], "path": parts[1]} for line in diff.splitlines() if len(parts := line.split("\t", 1)) == 2]
        return {"ready": bool(tasks) and not unfinished, "unfinished": unfinished,
            "changes": [{"title": settings["integration_branch"], "status": "integrated" if not unfinished else "waiting", "files": files, "gate_status": "pass" if tasks and not unfinished else None}],
            "integration_branch": settings["integration_branch"], "requires_confirmation": True}

    def confirm(self, team_id: str) -> dict[str, Any]:
        team = self.repo.get_team(team_id)
        settings = self.settings(team_id)
        assert settings is not None
        with project_lock(team.project_path):
            preview = self.preview(team_id)
            if not preview["ready"]:
                raise TaskNotReviewable("All workers must be reviewed and integrated before merging")
            git = Git(team.project_path)
            if git.current_branch() != team.base_ref or uncommitted_code(team.project_path):
                raise TaskNotReviewable(f"Check out {team.base_ref} with a clean working tree before confirming")
            head = git.rev_parse(settings["integration_branch"])
            target_head = git.rev_parse("HEAD")
            if git.run("merge-base", "--is-ancestor", "HEAD", head, check=False).returncode:
                raise TaskNotReviewable("The target advanced; update and revalidate the team branch before merging")
            record = next((row for row in self.storage.team_integrations(team_id) if row.get("integration_head") == head), None)
            if not record:
                raise TaskNotReviewable("The integration branch changed outside the reviewed workflow")
            candidate = record["candidate_path"]
            if Git(candidate).rev_parse("HEAD") != head or uncommitted_code(candidate):
                raise TaskNotReviewable("The validated integration candidate changed")
            command = team.gate_command
            if not command or not run_command(command, candidate, env=self.environment(team_id)).ok:
                raise TaskNotReviewable("Combined checks must pass before the final merge")
            if head != git.rev_parse(settings["integration_branch"]) or uncommitted_code(candidate):
                raise TaskNotReviewable("Integration changed during validation")
            if git.current_branch() != team.base_ref or git.rev_parse("HEAD") != target_head or uncommitted_code(team.project_path):
                raise TaskNotReviewable("The target changed during validation; review again")
            git.run("merge", "--ff-only", head)
            self.repo.update_team_details(team_id, state="completed")
            return {"completed": True, "entries": [], "commit": head}
