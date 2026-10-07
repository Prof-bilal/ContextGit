"""Scoped memory: the reasoning behind the code an agent is about to touch.

Nothing here is hand-written and nothing goes stale silently. It reads the same
join the Why lens uses — a blamed commit → the run that introduced it → that
run's extracted decisions — scoped to a set of path globs (a task's scope, or a
path the caller names).

The important part for an agent is `dead_ends`: the approaches the team already
rejected for exactly these files. No memory system on the market surfaces those.
"""

from __future__ import annotations

from pathlib import Path

from contextgit.core.models import MemoryBundle, MemoryRun
from contextgit.core.repo import Repo
from contextgit.endpoints.why import reasoning_for, why_history
from contextgit.llm.base import LLMProvider

MAX_FILES = 6
MAX_RUNS = 4
_SKIP_DIRS = {".git", ".contextgit", "node_modules", ".venv", "venv", "dist", "build"}


def scope_files(project: Path, patterns: list[str], *, limit: int = MAX_FILES) -> list[str]:
    """The files a set of globs currently matches, bounded and de-duplicated.

    A scope like `src/auth/**` rarely exists verbatim on disk, so a pattern that
    matches nothing is retried as a prefix. Literal paths are accepted too.
    """
    found: list[str] = []
    for pattern in patterns:
        cleaned = pattern.strip()
        if not cleaned or cleaned in {"*", "**", "**/*"}:
            continue
        candidates = [path for path in project.glob(cleaned) if path.is_file()]
        if not candidates:
            deep = f"{cleaned.rstrip('/')}/**/*"
            candidates = [path for path in project.glob(deep) if path.is_file()]
        if not candidates:
            literal = project / cleaned
            candidates = [literal] if literal.is_file() else []
        for path in sorted(candidates):
            relative = str(path.relative_to(project))
            if any(part in _SKIP_DIRS for part in Path(relative).parts):
                continue
            if relative not in found:
                found.append(relative)
            if len(found) >= limit:
                return found
    return found


def _dedupe(items: list[str]) -> list[str]:
    seen: dict[str, None] = {}
    for item in items:
        text = item.strip()
        if text:
            seen.setdefault(text, None)
    return list(seen)


def memory_for(
    repo: Repo,
    provider: LLMProvider | None,
    project: Path | str,
    patterns: list[str],
    *,
    scoped_by: str | None = None,
) -> MemoryBundle:
    """The decisions, dead ends and questions behind whatever these paths cover."""
    root = Path(project)
    files = scope_files(root, patterns)
    bundle = MemoryBundle(
        project_path=str(root),
        scoped_by=scoped_by,
        paths=list(patterns),
        files=files,
    )
    if not files:
        bundle.note = (
            "Nothing in the project matches this scope, so there is no recorded "
            "reasoning to show."
        )
        return bundle

    runs: dict[str, MemoryRun] = {}
    for relative in files:
        for finding in why_history(repo, root, relative, limit=2):
            if not finding.tracked or not finding.run_id:
                continue
            if finding.run_id in runs:
                if relative not in runs[finding.run_id].files:
                    runs[finding.run_id].files.append(relative)
                continue
            if len(runs) >= MAX_RUNS:
                break
            # Cached after the first ask: the model is never called twice.
            reasoning_for(repo, provider, root, finding)
            runs[finding.run_id] = MemoryRun(
                run_id=finding.run_id,
                run_name=finding.run_name,
                agent=finding.agent,
                model=finding.model,
                files=[relative],
                decisions=list(finding.decisions),
                dead_ends=list(finding.dead_ends),
                open_questions=list(finding.open_questions),
            )
        if len(runs) >= MAX_RUNS:
            break

    bundle.runs = list(runs.values())
    bundle.decisions = _dedupe([item for run in bundle.runs for item in run.decisions])
    bundle.dead_ends = _dedupe([item for run in bundle.runs for item in run.dead_ends])
    bundle.open_questions = _dedupe([item for run in bundle.runs for item in run.open_questions])
    if not bundle.runs:
        bundle.note = (
            "No recorded run has touched these files, so there is no reasoning "
            "behind them yet."
        )
    elif not bundle.dead_ends and not bundle.decisions:
        bundle.note = (
            "The runs behind these files have no extracted reasoning yet — open "
            "the Why tab on one of them to read it into the cache."
        )
    return bundle
