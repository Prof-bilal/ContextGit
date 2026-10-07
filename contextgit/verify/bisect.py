"""Find the change that broke behaviour — and the reasoning behind it.

git bisect tells you *which commit*; this also tells you *which run* and what it
decided, by attributing the culprit to the recorded conversation that introduced
it. Each probe runs in a throwaway worktree, so the user's checkout is never
touched.
"""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from contextgit.core.models import (
    BisectResult,
    BisectStep,
    EnvDrift,
    WhyFinding,
)
from contextgit.core.repo import Repo
from contextgit.gitops.repo import Git
from contextgit.llm.base import LLMProvider
from contextgit.verify.detect import detect_gate
from contextgit.verify.runner import run_command

MAX_PROBES = 12
PROBE_TIMEOUT = 300.0
WORKTREES_DIR = Path(".contextgit") / "bisect"


def _info(project: Path, sha: str) -> dict[str, str]:
    git = Git(project)
    result = git.run("log", "-1", "--format=%H%x1f%s", sha, check=False)
    parts = result.stdout.strip().split("\x1f") if result.returncode == 0 else []
    return {"id": parts[0], "summary": parts[1] if len(parts) > 1 else ""} if parts else {}


def first_parent_range(project: Path | str, good: str, bad: str) -> list[str]:
    """The commits between good and bad on the first-parent line, oldest first."""
    git = Git(Path(project))
    if not git.is_repo():
        return []
    result = git.run("rev-list", "--first-parent", "--reverse", f"{bad}", f"^{good}", check=False)
    if result.returncode != 0:
        return []
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def oldest_commit(project: Path | str) -> str | None:
    """The root of the first-parent line — the fallback 'good' when none is given."""
    git = Git(Path(project))
    if not git.is_repo():
        return None
    result = git.run("rev-list", "--first-parent", "HEAD", check=False)
    if result.returncode != 0:
        return None
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    return lines[-1] if lines else None


def _probe(project: Path, sha: str, command: str, timeout: float) -> tuple[bool, str]:
    """Run the gate at one commit, in a thrown-away worktree."""
    directory = project / WORKTREES_DIR / sha[:12]
    git = Git(project)
    if directory.exists():
        shutil.rmtree(directory, ignore_errors=True)
    directory.parent.mkdir(parents=True, exist_ok=True)
    added = git.run("worktree", "add", "--detach", str(directory), sha, check=False)
    if added.returncode != 0:
        return False, added.stderr.strip() or "could not check out that commit"
    try:
        result = run_command(command, directory, timeout=timeout)
        return result.ok, result.output
    finally:
        git.run("worktree", "remove", "--force", str(directory), check=False)
        shutil.rmtree(directory, ignore_errors=True)
        try:
            # Leave nothing behind, not even the (now empty) holding directory.
            directory.parent.rmdir()
        except OSError:
            pass


def bisect_gate(
    repo: Repo,
    project: Path | str,
    *,
    good: str,
    bad: str,
    command: str | None = None,
    provider: LLMProvider | None = None,
    timeout: float = PROBE_TIMEOUT,
    max_probes: int = MAX_PROBES,
) -> BisectResult:
    """Binary-search the project's history for the first commit that fails the gate."""
    root = Path(project)
    probe = command or detect_gate(root) or ""
    result = BisectResult(project_path=str(root), good=good, bad=bad, command=probe)
    if not probe:
        result.note = (
            "No test command to run: ContextGit could not detect one for this "
            "project, and none was given."
        )
        return result

    commits = first_parent_range(root, good, bad)
    if not commits:
        result.note = "Nothing changed between those two commits."
        return result

    # The ends bracket the search, so check them before trusting the range.
    good_ok, good_log = _probe(root, good, probe, timeout)
    result.probes += 1
    if not good_ok:
        result.note = f"The 'good' commit ({good[:7]}) does not pass the gate either."
        result.log = good_log[-2000:]
        return result
    bad_ok, bad_log = _probe(root, bad, probe, timeout)
    result.probes += 1
    if bad_ok:
        result.note = f"The 'bad' commit ({bad[:7]}) passes the gate — nothing to bisect."
        result.log = bad_log[-2000:]
        return result

    low, high = 0, len(commits) - 1  # commits[high] is known bad
    last_log = ""
    while low < high and result.probes < max_probes:
        middle = (low + high) // 2
        sha = commits[middle]
        ok, output = _probe(root, sha, probe, timeout)
        result.probes += 1
        info = _info(root, sha)
        result.steps.append(BisectStep(commit=sha, summary=info.get("summary"), ok=ok))
        last_log = output
        if ok:
            low = middle + 1
        else:
            high = middle

    culprit = commits[high]
    result.culprit = culprit
    result.culprit_summary = _info(root, culprit).get("summary")
    result.log = last_log[-2000:]
    if result.probes >= max_probes and low < high:
        result.note = (
            f"Stopped after {result.probes} probes — the culprit is somewhere in "
            f"this range, not pinned exactly."
        )
    _attribute(repo, root, result, culprit, provider)
    return result


def _attribute(
    repo: Repo, project: Path, result: BisectResult, culprit: str, provider: LLMProvider | None
) -> None:
    """Name the run behind the culprit, and its decisions when we have them."""
    from contextgit.endpoints.provenance import _run_for  # noqa: PLC0415 — avoids a cycle

    session = _run_for(repo, project, culprit)
    if session is None:
        return
    result.run_id = session.id
    result.run_name = session.name
    branches = repo.log(session.branch) if session.branch else []
    if not branches:
        return
    head = branches[0]
    finding = WhyFinding(
        code_commit=culprit,
        tracked=True,
        run_id=session.id,
        run_name=session.name,
        agent=session.agent,
        model=head.model,
        context_branch=session.branch,
    )
    try:
        from contextgit.endpoints.why import reasoning_for  # noqa: PLC0415

        reasoning_for(repo, provider, project, finding)
    except Exception:
        return
    result.decisions = list(finding.decisions)
    result.dead_ends = list(finding.dead_ends)
    # Two runs that disagree about the environment are a common cause of "it
    # worked yesterday" — surface it next to the culprit.
    older = next((item for item in repo.list_sessions() if item.id != session.id), None)
    if older is not None:
        result.env_drift = _drift(repo, older.id, session.id)
    else:
        result.env_drift = []


def _drift(repo: Repo, before: str, after: str) -> list[EnvDrift]:
    try:
        return repo.env_drift(after, before)
    except Exception:
        return []


def scratch_directory() -> Path:
    """Where probes are thrown away (kept out of the project's real worktrees)."""
    return Path(tempfile.gettempdir()) / "contextgit-bisect"
