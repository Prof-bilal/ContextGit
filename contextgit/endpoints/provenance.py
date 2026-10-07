"""Join an endpoint to the change that produced it — the point of this feature.

The chain is: handler line → `git blame` → the code commit → the run whose git
branch contains that commit → that run's context branch → the conversation and
its summary. When a line did not come from a recorded run we say so plainly
(`tracked=False`) instead of inventing a link.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from contextgit.core.errors import ContextGitError
from contextgit.core.models import Endpoint, EndpointGraph, EndpointProvenance, Session
from contextgit.core.repo import Repo
from contextgit.gitops.repo import Git

_SEPARATOR = "\x1f"


def _parse_time(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _blame_commit(project: Path, file: str, line: int) -> str | None:
    """The commit that last touched one line, or None for uncommitted lines."""
    git = Git(project)
    if not git.is_repo():
        return None
    result = git.run("blame", "-L", f"{line},{line}", "--porcelain", "--", file, check=False)
    if result.returncode != 0 or not result.stdout:
        return None
    first = result.stdout.splitlines()[0]
    sha = first.split(" ", 1)[0].strip()
    if not sha or set(sha) == {"0"}:
        return None
    return sha


def _commit_info(project: Path, sha: str) -> dict[str, str]:
    git = Git(project)
    result = git.run(
        "log", "-1", f"--format=%H{_SEPARATOR}%s{_SEPARATOR}%an{_SEPARATOR}%aI", sha, check=False
    )
    if result.returncode != 0:
        return {}
    parts = result.stdout.strip().split(_SEPARATOR)
    if len(parts) < 4:
        return {}
    return {"id": parts[0], "summary": parts[1], "author": parts[2], "at": parts[3]}


def _branches_containing(project: Path, sha: str) -> set[str]:
    git = Git(project)
    result = git.run("branch", "--format=%(refname:short)", "--contains", sha, check=False)
    if result.returncode != 0:
        return set()
    return {line.strip() for line in result.stdout.splitlines() if line.strip()}


def _run_for(repo: Repo, project: Path, sha: str) -> Session | None:
    """The recorded run whose git branch contains this commit, if any."""
    branches = _branches_containing(project, sha)
    if not branches:
        return None
    for session in repo.list_sessions():
        if session.git_branch and session.git_branch in branches:
            return session
    return None


def _run_context(
    repo: Repo, session: Session
) -> tuple[str | None, str | None, str | None, str | None]:
    """(context commit id, summary, model, excerpt of the last user message)."""
    try:
        commits = repo.log(session.branch)
    except ContextGitError:
        return None, None, None, None
    if not commits:
        return None, None, None, None
    head = commits[0]
    excerpt: str | None = None
    for message in reversed(head.messages):
        if message.role == "user" and message.content.strip():
            excerpt = message.content.strip()[:240]
            break
    return head.id, head.summary, head.model, excerpt


def endpoint_provenance(repo: Repo, project: Path | str, endpoint: Endpoint) -> EndpointProvenance:
    """Where this endpoint came from: the commit, the run, and its conversation."""
    root = Path(project)
    source = endpoint.source
    if not source.file or source.line is None:
        return EndpointProvenance()
    sha = _blame_commit(root, source.file, source.line)
    if sha is None:
        return EndpointProvenance()
    info = _commit_info(root, sha)
    provenance = EndpointProvenance(
        code_commit=sha,
        code_commit_summary=info.get("summary"),
        author=info.get("author"),
        committed_at=_parse_time(info.get("at", "")),
    )
    session = _run_for(repo, root, sha)
    if session is None:
        return provenance
    context_commit, summary, model, excerpt = _run_context(repo, session)
    provenance.tracked = True
    provenance.run_id = session.id
    provenance.run_name = session.name
    provenance.agent = session.agent
    provenance.model = model
    provenance.context_commit = context_commit
    provenance.context_branch = session.branch
    provenance.summary = summary
    provenance.excerpt = excerpt
    return provenance


def graph_with_provenance(repo: Repo, project: Path | str) -> EndpointGraph:
    """Discover a project's endpoints and attach the origin of each one."""
    from contextgit.endpoints.discover import discover  # noqa: PLC0415 — avoids a cycle

    graph = discover(project)
    for endpoint in graph.endpoints:
        endpoint.provenance = endpoint_provenance(repo, project, endpoint)
    return graph
