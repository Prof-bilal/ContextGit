"""A bounded, approval-gated repository task loop."""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from uuid import uuid4

from contextgit.core.models import (
    AgentApproval,
    AgentArtifact,
    AgentRun,
    AgentStep,
    LocalIssue,
    Message,
)
from contextgit.core.repo import Repo
from contextgit.gitops.repo import Git
from contextgit.issues.service import _quality_commands
from contextgit.llm.base import LLMProvider

_MAX_FILE_BYTES = 24_000
_MAX_FILES = 80
_MAX_OUTPUT = 12_000


def _project_path(repo: Repo) -> Path:
    return repo.root.parent if repo.root.name == ".contextgit" else repo.root


def _step(
    repo: Repo,
    run_id: str,
    sequence: int,
    kind: str,
    status: str,
    *,
    input_summary: str = "",
    output_summary: str = "",
    files: list[str] | None = None,
) -> AgentStep:
    value = AgentStep(
        id=uuid4().hex,
        run_id=run_id,
        sequence=sequence,
        kind=kind,
        status=status,  # type: ignore[arg-type]
        input_summary=input_summary[:2_000],
        output_summary=output_summary[:_MAX_OUTPUT],
        files=files or [],
    )
    repo.save_agent_step(value)
    return value


def _files(root: Path) -> list[str]:
    try:
        output = Git(root).run("ls-files", "-z").stdout
        paths = [entry for entry in output.split("\0") if entry]
        paths.extend(Git(root).changed_files("HEAD"))
    except Exception:
        paths = []
    return list(
        dict.fromkeys(
            path
            for path in paths
            if not any(
                part in {".git", ".contextgit", "node_modules", "dist", "build"}
                for part in Path(path).parts
            )
        )
    )[:_MAX_FILES]


def _context(root: Path, paths: list[str]) -> str:
    important = {"AGENTS.md", "README.md", "pyproject.toml", "package.json", "tsconfig.json"}
    selected = [path for path in paths if Path(path).name in important] + [
        path for path in paths if Path(path).name not in important
    ]
    blocks: list[str] = []
    for relative in selected[:_MAX_FILES]:
        path = root / relative
        try:
            if path.stat().st_size > _MAX_FILE_BYTES or b"\0" in path.read_bytes()[:4096]:
                continue
            content = path.read_text("utf-8", errors="ignore")[:_MAX_FILE_BYTES]
        except OSError:
            continue
        blocks.append(f"===== FILE: {relative} =====\n{content}")
    return "\n\n".join(blocks)


def _json_response(raw: str) -> dict[str, object]:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.IGNORECASE)
    value = json.loads(cleaned)
    if not isinstance(value, dict):
        raise ValueError("agent response must be a JSON object")
    return value


def _clean_patch(raw: str) -> str:
    """Extract a unified diff when a model adds Markdown or short commentary."""
    patch = raw.replace("\r\n", "\n").strip()
    marker = patch.find("diff --git ")
    if marker >= 0:
        patch = patch[marker:]
    fence = patch.find("```", len("diff --git "))
    if fence >= 0:
        patch = patch[:fence]
    patch = re.sub(r"^```(?:diff|patch)?\s*", "", patch, flags=re.IGNORECASE)
    patch = patch.strip()
    return f"{patch}\n" if patch else ""


def _plan(provider: LLMProvider, task: str, root: Path, paths: list[str]) -> dict[str, object]:
    prompt = f"""You are planning a safe repository implementation task.
Task: {task}

Return ONLY JSON with this shape:
{{"summary":"...","steps":["..."],"files":["relative/path"],"checks":["..."],"risks":["..."]}}

Only name files that exist in the supplied repository context. Prefer a small targeted file set.
Repository files and instructions:
{_context(root, paths)}"""
    value = _json_response(
        provider.complete(
            [
                Message(role="system", content="You produce strict repository task plans."),
                Message(role="user", content=prompt),
            ],
            temperature=0,
        )
    )
    files = [
        str(path) for path in value.get("files", []) if isinstance(path, str) and path in paths
    ]
    return {
        "summary": str(value.get("summary", task))[:2_000],
        "steps": [str(item)[:500] for item in value.get("steps", []) if isinstance(item, str)][:12],
        "files": files[:40],
        "checks": [str(item)[:300] for item in value.get("checks", []) if isinstance(item, str)][
            :8
        ],
        "risks": [str(item)[:500] for item in value.get("risks", []) if isinstance(item, str)][:8],
    }


def create_run(
    repo: Repo,
    task: str,
    provider: LLMProvider,
    provider_id: str | None = None,
    model: str | None = None,
) -> AgentRun:
    project = _project_path(repo)
    if not Git(project).is_repo():
        raise ValueError("Work mode requires a Git repository so changes can stay isolated")
    branch_name = f"work-{uuid4().hex[:12]}"
    session = repo.create_session(
        branch_name,
        kind="chat",
        branch=branch_name,
        agent=model,
        project_path=str(project),
        worktree=True,
        task=task,
        role="repository agent",
    )
    run = AgentRun(
        id=uuid4().hex,
        session_id=session.id,
        task=task,
        provider=provider_id,
        model=model,
        base_commit=session.base_commit,
        worktree_path=session.worktree_path,
        status="inspecting",
    )
    repo.create_agent_run(run)
    try:
        root = Path(session.worktree_path or project)
        paths = _files(root)
        _step(
            repo,
            run.id,
            1,
            "inspect",
            "done",
            output_summary=f"Inspected {len(paths)} repository files",
            files=paths[:40],
        )
        run.status = "planning"
        repo.save_agent_run(run)
        plan = _plan(provider, task, root, paths)
        run.plan = plan
        run.status = "awaiting_approval"
        repo.save_agent_run(run)
        repo.save_agent_artifact(
            AgentArtifact(
                id=uuid4().hex, run_id=run.id, kind="plan", content=json.dumps(plan, indent=2)
            )
        )
        plan_step = _step(
            repo,
            run.id,
            2,
            "plan",
            "done",
            output_summary=str(plan.get("summary", "Plan ready")),
            files=list(plan.get("files", [])),
        )
        repo.save_agent_approval(
            AgentApproval(
                id=uuid4().hex,
                run_id=run.id,
                step_id=plan_step.id,
                approval_type="plan",
                action="Approve the implementation plan",
                decision="pending",
            )
        )
    except Exception as exc:
        run.status = "failed"
        run.error = str(exc)[:500]
        repo.save_agent_run(run)
        _step(repo, run.id, 2, "plan", "failed", output_summary=run.error)
    return run


def _patch(provider: LLMProvider, run: AgentRun) -> str:
    root = Path(run.worktree_path or "")
    prompt = f"""Implement this approved repository task using a unified git diff.
Task: {run.task}
Approved plan:
{json.dumps(run.plan or {}, indent=2)}

Return ONLY JSON: {{"patch":"unified diff text"}}
    Rules: change only files in the approved plan, use repository-relative paths,
    do not include secrets, and return an empty patch only if no code change is needed.

Repository context:
{_context(root, list((run.plan or {}).get("files", [])))}"""
    value = _json_response(
        provider.complete(
            [
                Message(
                    role="system", content="You produce safe unified patches for an approved task."
                ),
                Message(role="user", content=prompt),
            ],
            temperature=0,
        )
    )
    return _clean_patch(str(value.get("patch", "")))[:100_000]


def _apply_patch(root: Path, patch: str) -> str | None:
    """Validate and apply one generated patch, returning a bounded error."""
    if any(
        part.startswith("/") or ".." in Path(part).parts
        for part in re.findall(r"(?:a|b)/([^\n]+)", patch)
    ):
        return "patch contains an unsafe path"
    for check_only in (True, False):
        command = ["git", "apply", "--whitespace=nowarn"]
        if check_only:
            command.append("--check")
        command.append("-")
        applied = subprocess.run(
            command,
            cwd=root,
            input=patch,
            text=True,
            capture_output=True,
            timeout=60,
            check=False,
        )
        if applied.returncode != 0:
            return (applied.stderr or applied.stdout or "git apply failed")[:500]
    return None


def _repair_patch(
    provider: LLMProvider, run: AgentRun, patch: str, error: str, attempt: int
) -> str:
    """Ask once for a syntactically valid replacement after git rejects a patch."""
    prompt = f"""Repair this repository patch so `git apply --check` accepts it.
Return ONLY JSON: {{"patch":"unified diff text"}}.
This is repair attempt {attempt}. Preserve the requested task and use
repository-relative paths only. Include the complete patch, including any new
files. Do not include Markdown fences, commentary, or `*** Begin Patch` markers.
Task: {run.task}
Patch error: {error}
Rejected patch:
{patch[:80_000]}"""
    value = _json_response(
        provider.complete(
            [
                Message(role="system", content="You repair malformed unified git patches."),
                Message(role="user", content=prompt),
            ],
            temperature=0,
        )
    )
    return _clean_patch(str(value.get("patch", "")))[:100_000]


def approve_plan(repo: Repo, run_id: str, provider: LLMProvider) -> AgentRun:
    run = repo.agent_run(run_id)
    if run.status != "awaiting_approval":
        return run
    run.status = "executing"
    repo.save_agent_run(run)
    try:
        step = _step(
            repo,
            run.id,
            len(repo.agent_steps(run.id)) + 1,
            "edit",
            "running",
            input_summary="Approved plan",
        )
        patch = _patch(provider, run)
        root = Path(run.worktree_path or "")
        if patch.strip():
            patch_error = _apply_patch(root, patch)
            if patch_error:
                for attempt in (1, 2):
                    repaired = _repair_patch(provider, run, patch, patch_error, attempt)
                    patch_error = _apply_patch(root, repaired)
                    if patch_error is None:
                        break
            if patch_error:
                raise ValueError(f"Agent generated an invalid patch: {patch_error}")
        changed = Git(root).changed_files(run.base_commit or "HEAD")
        step.status = "done"
        step.output_summary = f"Applied patch; {len(changed)} files changed"
        step.files = changed[:40]
        repo.update_agent_step(step)
        run.status = "validating"
        repo.save_agent_run(run)
        checks = _quality_commands(root)
        results: list[str] = []
        for label, argv in checks:
            result = subprocess.run(
                argv, cwd=root, capture_output=True, text=True, timeout=120, check=False
            )
            output = (result.stdout or result.stderr or "")[:_MAX_OUTPUT]
            results.append(f"{label}: {'passed' if result.returncode == 0 else 'failed'}\n{output}")
        validation = "\n\n".join(results) or "No safe validation commands discovered."
        repo.save_agent_artifact(
            AgentArtifact(id=uuid4().hex, run_id=run.id, kind="check", content=validation)
        )
        repo.save_agent_artifact(
            AgentArtifact(
                id=uuid4().hex,
                run_id=run.id,
                kind="diff",
                content=Git(root).run("diff", check=False).stdout[:100_000],
            )
        )
        _step(
            repo,
            run.id,
            len(repo.agent_steps(run.id)) + 1,
            "validate",
            "done",
            output_summary=validation,
        )
        run.status = "ready"
        repo.save_agent_run(run)
    except Exception as exc:
        run.status = "failed"
        run.error = str(exc)[:500]
        repo.save_agent_run(run)
    return run


def reject_plan(repo: Repo, run_id: str) -> AgentRun:
    run = repo.agent_run(run_id)
    if run.status == "awaiting_approval":
        run.status = "cancelled"
        repo.save_agent_run(run)
    return run


def commit_run(repo: Repo, run_id: str, message: str | None = None) -> AgentRun:
    run = repo.agent_run(run_id)
    if run.status != "ready" or not run.worktree_path:
        return run
    root = Path(run.worktree_path)
    git = Git(root)
    changed = git.changed_files(run.base_commit or "HEAD")
    if not changed:
        raise ValueError("There are no changes to commit")
    git.run("add", "-A")
    git.run("commit", "-m", (message or run.task)[:120])
    run.resulting_commit = git.rev_parse("HEAD")
    run.status = "completed"
    repo.save_agent_run(run)
    _step(
        repo,
        run.id,
        len(repo.agent_steps(run.id)) + 1,
        "commit",
        "done",
        output_summary=run.resulting_commit,
        files=changed,
    )
    return run


def create_run_issue(repo: Repo, run_id: str, title: str, body: str) -> LocalIssue:
    run = repo.agent_run(run_id)
    issue = LocalIssue(
        id=uuid4().hex,
        title=title[:240],
        body=body[:20_000],
        source="agent",
        agent_run_id=run.id,
        commit_id=run.resulting_commit,
        branch=Git(run.worktree_path).current_branch() if run.worktree_path else None,
    )
    repo.create_local_issue(issue)
    run.local_issue_id = issue.id
    repo.save_agent_run(run)
    repo.save_agent_artifact(
        AgentArtifact(id=uuid4().hex, run_id=run.id, kind="issue", content=body)
    )
    return issue
