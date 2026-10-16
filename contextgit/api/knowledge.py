"""Checkpoint and review routes; all identities are resolved from stored records."""

from collections.abc import Callable, Coroutine
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import BaseModel, Field
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from contextgit.core.repo import Repo
from contextgit.knowledge.models import Checkpoint, ExportRequest, Feedback, Lesson, LessonApproval
from contextgit.knowledge.providers import ConnectionRequest, LearningConnections
from contextgit.llm import FakeProvider, LLMProvider, all_provider_infos
from contextgit.llm.registry import ProviderInfo


class DraftRequest(BaseModel):
    provider: str | None = None
    model: str = ""


class PreflightRequest(BaseModel):
    project_path: str
    category: str = Field(default="", max_length=80)
    scope: list[str] = Field(default_factory=list, max_length=100)
    task: str = Field(default="", max_length=4000)


class KnowledgeRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def handle(request: Request) -> Response:
            try:
                return await handler(request)
            except RequestValidationError:
                if "/knowledge/provider-settings" not in request.url.path:
                    raise
                # Validation errors otherwise echo their input, including API keys.
                return JSONResponse(
                    {"detail": "Check the provider, model, API key, and endpoint fields."},
                    status_code=422,
                )
            except ValueError as error:
                return JSONResponse({"detail": str(error)}, status_code=409)
            except OSError:
                return JSONResponse(
                    {
                        "detail": "Could not write project knowledge. "
                        "The saved checkpoint is recoverable; check folder permissions."
                    },
                    status_code=409,
                )

        return handle


def router(get_repo: Callable[[], Repo], llm: LLMProvider, injected: bool) -> APIRouter:
    routes = APIRouter(prefix="/api/v1", route_class=KnowledgeRoute)
    dep = Depends(get_repo)

    @routes.get("/knowledge/providers")
    def providers(repo: Repo = dep) -> list[ProviderInfo]:
        return [
            item
            for item in all_provider_infos(repo.list_providers())
            if item.configured and item.kind != "mock" and item.capability == "chat"
        ]

    @routes.get("/knowledge/provider-settings")
    def connection_settings(repo: Repo = dep) -> dict[str, object]:
        return LearningConnections(repo).settings(injected or not isinstance(llm, FakeProvider))

    @routes.put("/knowledge/provider-settings")
    def save_connection(body: ConnectionRequest, repo: Repo = dep) -> ProviderInfo:
        return LearningConnections(repo).save(body)

    @routes.post("/knowledge/provider-settings/test")
    def test_connection(body: ConnectionRequest, repo: Repo = dep) -> dict[str, str]:
        return LearningConnections(repo).test(body)

    @routes.post("/sessions/{session_id}/checkpoint")
    def checkpoint(session_id: str, repo: Repo = dep) -> dict[str, object]:
        return repo.knowledge.checkpoint(session_id)

    @routes.get("/sessions/{session_id}/checkpoint")
    def latest(session_id: str, repo: Repo = dep) -> Checkpoint | None:
        return repo.knowledge.latest(session_id)

    @routes.post("/sessions/{session_id}/checkpoint/export")
    def export(session_id: str, body: ExportRequest, repo: Repo = dep) -> Checkpoint:
        return repo.knowledge.export(session_id, body.checkpoint_id, body.markdown)

    @routes.post("/sessions/{session_id}/feedback")
    def feedback(session_id: str, body: Feedback, repo: Repo = dep) -> Checkpoint:
        return repo.knowledge.feedback(session_id, body)

    @routes.get("/knowledge")
    def overview(project_path: str = Query(), repo: Repo = dep) -> dict[str, object]:
        return repo.knowledge.overview(project_path)

    @routes.post("/knowledge/preflight")
    def preflight(body: PreflightRequest, repo: Repo = dep) -> dict[str, object]:
        return repo.knowledge.preflight(body.project_path, body.category, body.scope, body.task)

    @routes.post("/sessions/{session_id}/learning-draft")
    def draft(session_id: str, body: DraftRequest, repo: Repo = dep) -> Lesson:
        active, model = LearningConnections(repo).resolve(body.provider, llm, injected, body.model)
        try:
            return repo.knowledge.draft(session_id, active, model)
        except RuntimeError as error:
            raise HTTPException(502, LearningConnections.failure(active, error)) from error

    @routes.post("/sessions/{session_id}/checkpoint/clean")
    def clean(session_id: str, body: DraftRequest, repo: Repo = dep) -> dict[str, str]:
        active, model = LearningConnections(repo).resolve(body.provider, llm, injected, body.model)
        try:
            return {"markdown": repo.knowledge.clean(session_id, active, model)}
        except RuntimeError as error:
            raise HTTPException(502, LearningConnections.failure(active, error)) from error

    @routes.post("/project-memory/drafts/{identity}/approve")
    def approve(identity: str, body: LessonApproval, repo: Repo = dep) -> Lesson:
        return repo.knowledge.review(identity, body.instruction, body.resolve_conflicts)

    @routes.post("/project-memory/drafts/{identity}/reject")
    def reject(identity: str, repo: Repo = dep) -> Lesson:
        return repo.knowledge.review(identity, None)

    @routes.post("/knowledge/refresh")
    def refresh(body: PreflightRequest, repo: Repo = dep) -> dict[str, str]:
        repo.knowledge.refresh_context(repo.knowledge.project(body.project_path))
        return {"status": "ready"}

    return routes
