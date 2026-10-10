"""Local capture/recovery API with explicit, actionable capture states."""

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from contextgit.core.repo import Repo
from contextgit.integration.transcript import CaptureUnavailable


class BindingRequest(BaseModel):
    native_id: str


def router(get_repo: Callable[[], Repo]) -> APIRouter:
    routes = APIRouter(prefix="/api/v1")
    repo_dep = Depends(get_repo)

    @routes.get("/sessions/{session_id}/capture")
    def state(session_id: str, repo: Repo = repo_dep) -> dict[str, Any]:
        try:
            binding = repo.transcripts.binding(session_id)
            candidates = []
            if not binding:
                try:
                    candidates = repo.transcripts.choices(session_id)
                except CaptureUnavailable as discovery_error:
                    if discovery_error.status != "missing":
                        raise
                    # A first-ever OpenCode launch creates its native database.
                    return {
                        "status": "unbound",
                        "binding": None,
                        "candidates": [],
                        "discovery_status": "missing",
                    }
            return {
                "status": "bound" if binding else "unbound",
                "binding": binding,
                "candidates": candidates,
            }
        except CaptureUnavailable as error:
            return {"status": error.status, "detail": str(error), "candidates": []}

    @routes.put("/sessions/{session_id}/capture")
    def bind(session_id: str, body: BindingRequest, repo: Repo = repo_dep) -> dict[str, Any]:
        try:
            repo.transcripts.bind(session_id, body.native_id, require_complete=False)
            return state(session_id, repo)
        except CaptureUnavailable as error:
            raise HTTPException(409, {"status": error.status, "message": str(error)}) from error

    @routes.post("/sessions/{session_id}/capture")
    def capture(session_id: str, repo: Repo = repo_dep) -> dict[str, Any]:
        try:
            messages = repo.transcripts.capture(session_id)
            return {
                "status": "ready",
                "messages": [item.model_dump(mode="json") for item in messages],
            }
        except CaptureUnavailable as error:
            candidates = []
            if error.status == "unbound":
                try:
                    candidates = repo.transcripts.choices(session_id)
                except CaptureUnavailable as discovery_error:
                    return {
                        "status": discovery_error.status,
                        "detail": str(discovery_error),
                        "messages": [],
                        "candidates": [],
                    }
            return {
                "status": error.status,
                "detail": str(error),
                "messages": [],
                "candidates": candidates,
            }

    cursor_query = Query(default=0, ge=0)
    limit_query = Query(default=50, ge=1, le=200)

    @routes.get("/commits/{commit_id}/conversation/page")
    def conversation_page(
        commit_id: str,
        cursor: int = cursor_query,
        limit: int = limit_query,
        repo: Repo = repo_dep,
    ) -> dict[str, Any]:
        messages, next_cursor = repo.conversation_page(commit_id, cursor, limit)
        return {
            "messages": [message.model_dump(mode="json") for message in messages],
            "next_cursor": next_cursor,
        }

    return routes
