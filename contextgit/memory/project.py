"""Bounded project-memory synthesis from recorded AI sessions."""

from __future__ import annotations

import json
from pathlib import Path
from uuid import uuid4

from contextgit.core.models import MemoryConflict, Message, ProjectMemoryRevision
from contextgit.core.repo import Repo
from contextgit.llm.base import LLMProvider

_MAX_SESSIONS = 24
_MAX_MESSAGES = 24
_MAX_TEXT = 1_600


def _clean_list(value: object, limit: int = 32) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip()[:_MAX_TEXT] for item in value if str(item).strip()][:limit]


def _parse(raw: str) -> dict[str, object]:
    value = raw.strip()
    if value.startswith("```"):
        value = value.split("\n", 1)[1] if "\n" in value else value
        value = value.rsplit("```", 1)[0]
    parsed = json.loads(value.strip())
    if not isinstance(parsed, dict):
        raise ValueError("project-memory response must be a JSON object")
    return parsed


def _session_text(repo: Repo, session: object) -> dict[str, object]:
    # The object is a Session, kept untyped here to avoid a second public input model.
    branch = getattr(session, "branch")
    commits = repo.log(branch)
    messages = repo.build_context(commits[0].id) if commits else []
    staged = repo.staged(getattr(session, "id"))
    messages = [*messages[-_MAX_MESSAGES:], *staged[-8:]]
    run = next((item for item in repo.agent_runs(500) if item.session_id == getattr(session, "id")), None)
    return {
        "id": getattr(session, "id"),
        "name": getattr(session, "name"),
        "task": getattr(session, "task"),
        "role": getattr(session, "role"),
        "skills": getattr(session, "skills"),
        "scope": getattr(session, "scope"),
        "branch": branch,
        "commits": [commit.id for commit in commits[:12]],
        "run": run.model_dump(mode="json") if run else None,
        "messages": [{"role": item.role, "content": item.content[:_MAX_TEXT]} for item in messages],
    }


def synthesize_project_memory(
    repo: Repo,
    provider: LLMProvider,
    project_path: str | Path,
    session_ids: list[str] | None = None,
    *,
    provider_id: str | None = None,
    model: str | None = None,
) -> ProjectMemoryRevision:
    canonical = repo.canonical_project_path(project_path)
    sessions = [session for session in repo.list_sessions() if session.project_path == canonical]
    by_id = {session.id: session for session in sessions}
    selected = session_ids or [session.id for session in sessions]
    if len(selected) > _MAX_SESSIONS:
        selected = selected[-_MAX_SESSIONS:]
    if any(session_id not in by_id for session_id in selected):
        raise ValueError("all synthesis sessions must belong to the selected project")
    sources = [_session_text(repo, by_id[session_id]) for session_id in selected]
    existing = repo.project_memory(canonical)
    existing_payload = existing.model_dump(mode="json") if existing else None
    prompt = f"""Synthesize durable project knowledge from these ContextGit AI sessions.
Return ONLY JSON with these keys:
summary, architecture, workflow, conventions, decisions, rejected, skills,
validation, open_questions, conflicts.
Each list must contain concise strings. conflicts must be objects with topic,
existing, proposed, source_session_ids. Do not invent facts. Preserve useful
existing knowledge unless the sources clearly update it. Treat contradictory
claims as conflicts instead of silently choosing one.

Existing approved memory:
{json.dumps(existing_payload, ensure_ascii=False)}

Session sources:
{json.dumps(sources, ensure_ascii=False)}"""
    result = provider.complete(
        [
            Message(role="system", content="You maintain precise, auditable project memory."),
            Message(role="user", content=prompt),
        ],
        model=model or "",
        temperature=0,
    )
    value = _parse(str(result))
    conflicts: list[MemoryConflict] = []
    raw_conflicts = value.get("conflicts", [])
    if isinstance(raw_conflicts, list):
        for item in raw_conflicts[:32]:
            if isinstance(item, dict):
                conflicts.append(MemoryConflict.model_validate(item))
    source_commit_ids = [commit_id for source in sources for commit_id in source["commits"]]
    return ProjectMemoryRevision(
        id=uuid4().hex,
        project_path=canonical,
        revision=repo.next_project_memory_revision(canonical),
        status="draft",
        summary=str(value.get("summary", ""))[:_MAX_TEXT],
        architecture=_clean_list(value.get("architecture")),
        workflow=_clean_list(value.get("workflow")),
        conventions=_clean_list(value.get("conventions")),
        decisions=_clean_list(value.get("decisions")),
        rejected=_clean_list(value.get("rejected")),
        skills=_clean_list(value.get("skills")),
        validation=_clean_list(value.get("validation")),
        open_questions=_clean_list(value.get("open_questions")),
        conflicts=conflicts,
        source_session_ids=selected,
        source_commit_ids=list(dict.fromkeys(source_commit_ids)),
        provider=provider_id,
        model=model,
    )
