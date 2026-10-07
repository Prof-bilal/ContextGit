"""Why a line of code exists: the reasoning from the change that produced it.

`git blame` answers *who* and *when*. This answers *why* — the decisions, the
rejected alternatives and the open questions from the run that wrote the code —
by joining a blamed commit to the recorded run whose branch contains it, and
extracting meaning from that run's own messages.

Extraction is an LLM call, so it is cached per (branch, base, head) under
`<project>/.contextgit/why/` and never repeated for the same change.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from contextgit.core.errors import ContextGitError
from contextgit.core.models import Message, WhyAnswer, WhyFinding
from contextgit.core.repo import Repo
from contextgit.endpoints.provenance import _parse_time, _run_for
from contextgit.gitops.repo import Git
from contextgit.llm.base import LLMProvider
from contextgit.merge.engine import messages_since
from contextgit.merge.models import SemanticExtraction
from contextgit.merge.semantic import extract_semantics

CACHE_DIR = Path(".contextgit") / "why"
MAX_CHANGES = 5
_SEPARATOR = "\x1f"


def file_commits(
    project: Path | str, path: str, *, limit: int = MAX_CHANGES, as_of: str | None = None
) -> list[dict[str, str]]:
    """The commits that touched a file, newest first (optionally as of a ref)."""
    root = Path(project)
    git = Git(root)
    if not git.is_repo():
        return []
    args: list[str] = [
        "log",
        f"-{max(1, limit)}",
        f"--format=%H{_SEPARATOR}%s{_SEPARATOR}%an{_SEPARATOR}%aI",
    ]
    if as_of:
        args.append(as_of)
    args.extend(["--", path])
    result = git.run(*args, check=False)
    if result.returncode != 0:
        return []
    commits: list[dict[str, str]] = []
    for line in result.stdout.splitlines():
        parts = line.split(_SEPARATOR)
        if len(parts) < 4:
            continue
        commits.append({"id": parts[0], "summary": parts[1], "author": parts[2], "at": parts[3]})
    return commits


def _finding_for(repo: Repo, project: Path, info: dict[str, str], line: int | None) -> WhyFinding:
    """A commit-shaped finding, linked to its run when there is one."""
    commit = info.get("id")
    finding = WhyFinding(
        code_commit=commit,
        summary=info.get("summary"),
        author=info.get("author"),
        committed_at=_parse_time(info.get("at", "")),
    )
    if not commit:
        return finding
    session = _run_for(repo, project, commit)
    if session is None:
        return finding
    finding.tracked = True
    finding.run_id = session.id
    finding.run_name = session.name
    finding.agent = session.agent
    finding.context_branch = session.branch
    try:
        head = repo.log(session.branch)
    except Exception:
        return finding
    if not head:
        return finding
    finding.model = head[0].model
    for message in reversed(head[0].messages):
        if message.role == "user" and message.content.strip():
            finding.excerpt = message.content.strip()[:240]
            break
    return finding


def _cache_file(project: Path, session_branch: str, base: str | None, head: str) -> Path:
    key = hashlib.sha256(f"{session_branch}|{base}|{head}|v1".encode()).hexdigest()[:32]
    return project / CACHE_DIR / f"{key}.json"


def _run_messages(repo: Repo, branch: str, base: str | None) -> list[Message]:
    """What this run added: its messages since the base it branched from."""
    commits = repo.log(branch)
    if not commits:
        return []
    head = commits[0]
    if base:
        try:
            return messages_since(head.id, base, repo.get_commit)
        except Exception:
            return head.messages
    return head.messages


def reasoning_for(
    repo: Repo, provider: LLMProvider | None, project: Path, finding: WhyFinding
) -> None:
    """Fill a finding's decisions / dead ends / questions from its run, cached."""
    if not finding.tracked or not finding.context_branch or not finding.run_id:
        return
    try:
        session = repo.get_session(finding.run_id)
    except ContextGitError:
        return
    if session is None:
        return
    commits = repo.log(session.branch)
    if not commits:
        return
    head = commits[0]
    cache_file = _cache_file(project, session.branch, session.base_commit, head.id)
    if cache_file.exists():
        try:
            cached = SemanticExtraction.model_validate_json(cache_file.read_text("utf-8"))
        except ValueError:
            cached = None
        if cached is not None:
            _apply(finding, cached)
            return

    messages = _run_messages(repo, session.branch, session.base_commit)
    if not messages or provider is None:
        return
    extraction, fallback = extract_semantics(messages, [], provider)
    if fallback:
        # A failed extraction is not a result: never cache it.
        return
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(extraction.model_dump_json(indent=2) + "\n", "utf-8")
    _apply(finding, extraction)


def _apply(finding: WhyFinding, extraction: SemanticExtraction) -> None:
    finding.decisions = list(extraction.decisions)
    finding.dead_ends = list(extraction.dead_ends)
    finding.open_questions = list(extraction.open_questions)
    finding.facts = list(extraction.facts)


def why_history(
    repo: Repo, project: Path | str, path: str, *, limit: int = MAX_CHANGES
) -> list[WhyFinding]:
    """The timeline of changes to a file, newest first — no LLM involved."""
    root = Path(project)
    return [_finding_for(repo, root, info, None) for info in file_commits(root, path, limit=limit)]


def why_for(
    repo: Repo,
    provider: LLMProvider | None,
    project: Path | str,
    path: str,
    *,
    line: int | None = None,
    as_of: str | None = None,
    with_reasoning: bool = True,
) -> WhyAnswer:
    """Why this path (or line) exists, and what was considered instead."""
    root = Path(project)
    commits = file_commits(root, path, as_of=as_of)
    answer = WhyAnswer(path=path, line=line, as_of=as_of)
    if not commits:
        answer.note = "No recorded changes for this path yet."
        return answer

    findings = [_finding_for(repo, root, info, line) for info in commits]
    answer.findings = findings
    primary = findings[0]

    if not with_reasoning:
        return answer
    reasoning_for(repo, provider, root, primary)
    answer.reasoned = bool(primary.decisions or primary.dead_ends or primary.open_questions)
    if not primary.tracked:
        answer.note = (
            "This change did not come from a recorded run, so there is no reasoning "
            "to show — only the commit itself."
        )
    elif provider is None and not answer.reasoned:
        answer.note = "Connect a provider to read the reasoning behind this change."
    return answer


def cached_extraction_count(project: Path | str) -> int:
    """How many extractions are cached (used by tests and diagnostics)."""
    directory = Path(project) / CACHE_DIR
    return len(list(directory.glob("*.json"))) if directory.is_dir() else 0


def cache_key(project: Path | str, branch: str, base: str | None, head: str) -> str:
    """The cache file stem for one change, so callers can assert on it."""
    return _cache_file(Path(project), branch, base, head).stem


def dump_finding(finding: WhyFinding) -> str:
    """A finding as JSON, for logging."""
    return json.dumps(finding.model_dump(mode="json"), indent=2)
