"""Reviewed project/global skills, immutable revision history and instruction snapshots."""

import json
import os
import re
from pathlib import Path
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field

from contextgit.core.models import utcnow


class SkillDraft(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    instruction: str = Field(min_length=1, max_length=12000)
    evidence: str = Field(default="", max_length=6000)
    scope: list[str] = Field(default_factory=list)
    source_team: str | None = None
    source_session: str | None = None
    source_lesson: str | None = None


class LibrarySkill(SkillDraft):
    id: str
    origin: Literal["project", "global"] = "project"
    status: Literal["draft", "approved", "rejected", "removed"] = "draft"
    revision: int = 1
    updated_at: str


class SkillLibrary:
    def __init__(self, project: str, global_root: Path | None = None) -> None:
        self.project = Path(project).resolve() / ".contextgit" / "knowledge" / "skills"
        app_root = Path(
            os.environ.get("CONTEXTGIT_ROOT")
            or Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share"))
            / "dev.contextgit.desktop"
        )
        self.global_root = global_root or app_root / "skills"

    def _root(self, origin: str) -> Path:
        if origin not in {"global", "project"}:
            raise ValueError("unknown skill origin")
        return self.global_root if origin == "global" else self.project

    def _folder(self, origin: str, identity: str) -> Path:
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,120}", identity):
            raise ValueError("invalid skill id")
        return self._root(origin) / identity

    def list(self, include_removed: bool = False) -> list[LibrarySkill]:
        result = []
        for origin in ("project", "global"):
            root = self._root(origin)
            for path in sorted(root.glob("*/registry.json")) if root.exists() else []:
                try:
                    skill = LibrarySkill.model_validate_json(path.read_text())
                    if include_removed or skill.status != "removed":
                        result.append(skill)
                except (ValueError, OSError):
                    continue
        return result

    def get(self, origin: str, identity: str) -> LibrarySkill:
        return LibrarySkill.model_validate_json(
            (self._folder(origin, identity) / "registry.json").read_text()
        )

    def _save(self, skill: LibrarySkill) -> LibrarySkill:
        folder = self._folder(skill.origin, skill.id)
        folder.mkdir(parents=True, exist_ok=True)
        data = skill.model_dump_json(indent=2)
        # A revision is never overwritten, even after rejection/removal/promotion.
        with (folder / f"revision-{skill.revision}.json").open("x") as stream:
            stream.write(data)
        temporary = folder / f"registry-{uuid4().hex}.tmp"
        temporary.write_text(data)
        temporary.replace(folder / "registry.json")
        document = folder / "SKILL.md"
        if skill.status == "approved":
            document.write_text(
                f"---\nname: skill-{skill.id}\ndescription: {json.dumps(skill.title)}\n---\n\n"
                f"# {skill.title}\n\n{skill.instruction}\n\n"
                f"Scope: {', '.join(skill.scope) or 'Project'}\n"
                f"Evidence: {skill.evidence}\nSource team: {skill.source_team or 'user'}\n"
            )
        elif document.exists():
            # Archive the active document along with its immutable registry history.
            document.replace(folder / f"inactive-{skill.revision}.md")
        return skill

    def propose(self, draft: SkillDraft) -> LibrarySkill:
        return self._save(
            LibrarySkill(**draft.model_dump(), id=uuid4().hex, updated_at=utcnow().isoformat())
        )

    def review(
        self, origin: str, identity: str, action: str, instruction: str | None = None
    ) -> LibrarySkill:
        skill = self.get(origin, identity)
        if action == "promote":
            if skill.status != "approved":
                raise ValueError("approve the skill before promoting it")
            if origin == "global":
                return skill
            return self._save(
                skill.model_copy(
                    update={
                        "id": uuid4().hex,
                        "origin": "global",
                        "revision": 1,
                        "updated_at": utcnow().isoformat(),
                    }
                )
            )
        states = {"approve": "approved", "reject": "rejected", "remove": "removed"}
        if action not in states:
            raise ValueError("unknown skill action")
        return self._save(
            LibrarySkill.model_validate(
                {
                    **skill.model_dump(),
                    "status": states[action],
                    "instruction": instruction or skill.instruction,
                    "revision": skill.revision + 1,
                    "updated_at": utcnow().isoformat(),
                }
            )
        )
